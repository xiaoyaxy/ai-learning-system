import { z } from "zod";
import { ProjectRepository } from "../../db/repository";
import type { ToolContext } from "../../runtime/tool-context";
import type { RoleExecutor } from "../planning/service";
import type {
  ArtifactRef,
  EntityWrite,
  StepWriteSet,
  WorkspaceRecord,
} from "../../db/types";
import type { PendingInput } from "@learning/contracts";
import { TaskRunner } from "../../runtime/runner";
import { authorizeTool } from "../../domain/permissions";
import { ApiError } from "../../http/errors";
import { artifactWrite, commitArtifact } from "../artifacts";
import { reviewDates, localDate } from "./review";
import { publicTimestamp } from "../../http/projector";
const quote = z
  .object({ text: z.string().min(1).max(2000), message_id: z.string() })
  .strict();
const CardSchema = z
  .object({
    problem: quote.nullable(),
    understood_points: z.array(quote).max(3),
    helpful_example: quote.nullable(),
    unclear: quote.nullable(),
    skill_id: z.string(),
  })
  .strict();
const ReviewSchema = z
  .object({
    comments: z
      .array(
        z
          .object({
            paragraph_index: z.number().int().positive(),
            quote: z.string().min(1).max(1000),
            issue: z.string().min(1).max(500),
            action: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(12),
    fact_checks: z
      .array(
        z
          .object({
            quote: z.string().min(1).max(1000),
            reason: z.string().min(1).max(500),
            status: z.literal("needs_manual_verification"),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const WEEKLY_QUESTIONS = [
  "起点时，你的主要误解在哪里？",
  "哪份资料对你帮助最大，为什么？",
  "哪个追问暴露了最大的理解缺口？",
  "下一轮，你准备怎样调整学习方法？",
];
export function quizStatistics(w: WorkspaceRecord) {
  const first = w.attempts.filter(
      (a) =>
        Number(a.attempt_index) === 1 &&
        w.questions.some(
          (q) =>
            q.id === a.question_id &&
            w.sessions.some(
              (s) => s.id === q.session_id && s.purpose !== "weekly_review",
            ),
        ),
    ),
    verdicts = first.map(
      (a) =>
        w.evaluations.filter((e) => e.attempt_id === a.id).at(-1)?.verdict ??
        "ungraded",
    );
  return {
    answer_count: first.length,
    correct_count: verdicts.filter((v) => v === "correct").length,
    incorrect_count: verdicts.filter((v) => v === "incorrect").length,
    partial_count: verdicts.filter((v) => v === "partial").length,
    needs_review_count: verdicts.filter(
      (v) => v === "needs_review" || v === "ungraded",
    ).length,
    attempt_ids: first.map((a) => String(a.id)),
    basis: "逐题第一答的最新评价；练习统计不等同于完成检验",
  };
}
export class ArchiveService {
  constructor(
    private repo: ProjectRepository,
    private execute: RoleExecutor,
  ) {}
  private async workspace(ctx: ToolContext) {
    await this.repo.getProject(ctx.owner_id, ctx.project_id);
    return this.repo.readWorkspace(ctx.project_id);
  }
  private async commit(ctx: ToolContext, key: string, writes: StepWriteSet) {
    const p = await this.repo.getProject(ctx.owner_id, ctx.project_id);
    return this.repo.commitStep(
      { ...ctx, base_revision: p.revision, step_key: key },
      writes,
    );
  }
  async createLearningCard(
    ctx: ToolContext,
    evidenceIds: string[],
  ): Promise<{ id?: string; version?: number; missing_fields?: string[] }> {
    authorizeTool(ctx, { type: "write_artifact", kind: "learning_card" });
    const w = await this.workspace(ctx),
      messages = w.messages.filter(
        (m) => evidenceIds.includes(m.id) && m.sender_role === "user",
      );
    if (!messages.length || messages.length !== new Set(evidenceIds).size)
      throw new ApiError("FORBIDDEN", 403);
    const definition = w.artifacts
        .filter((a) => a.kind === "definition")
        .at(-1),
      skills = definition
        ? (JSON.parse(definition.content).skills as string[])
        : [];
    const receipt = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key: "learning_card",
        role: "curator",
        action: { type: "write_artifact", kind: "learning_card" },
        input: {
          evidence: messages.map((m) => ({ id: m.id, text: m.body })),
          skills,
          output_contract: {
            problem: "literal {text,message_id} or null",
            understood_points:
              "up to three distinct literal learner statements; never fill absent points",
            helpful_example: "literal {text,message_id} or null",
            unclear: "literal {text,message_id} or null",
            skill_id: "provided skill ID",
          },
        },
      },
      async (step) => {
        const r = await this.execute({
          project_id: ctx.project_id,
          run_id: ctx.run_id,
          epoch: ctx.epoch,
          step_key: step.key,
          role: "curator",
          action: "learning_card",
          evidence_ids: evidenceIds,
          public_context: step.input,
        });
        const value = CardSchema.parse(r.content);
        for (const q of [
          value.problem,
          ...value.understood_points,
          value.helpful_example,
          value.unclear,
        ].filter((x) => x !== null)) {
          if (
            !messages.some(
              (m) => m.id === q!.message_id && m.body.includes(q!.text),
            )
          )
            throw new ApiError("MODEL_INVALID_RESULT", 422);
        }
        return r;
      },
      async (r): Promise<StepWriteSet> => {
        const card = CardSchema.parse(r.content),
          missing: string[] = [];
        if (!card.problem) missing.push("problem");
        if (
          card.understood_points.length !== 3 ||
          new Set(card.understood_points.map((q) => q.text)).size !== 3
        )
          missing.push("understood_points");
        if (!card.helpful_example) missing.push("helpful_example");
        if (!card.unclear) missing.push("unclear");
        if (!skills.includes(card.skill_id)) missing.push("skill_id");
        if (missing.length)
          return {
            entities: [
              {
                table: "messages",
                row: {
                  id: crypto.randomUUID(),
                  sender_role: "curator",
                  body:
                    "学习卡还缺少：" +
                    missing
                      .map(
                        (k) =>
                          ({
                            problem: "资料解决的问题",
                            understood_points: "你读懂的三个不同点",
                            helpful_example: "最有帮助的例子",
                            unclear: "仍说不清的地方",
                            skill_id: "明确的技能范围",
                          })[k],
                      )
                      .join("、") +
                    "。请补充自己的表达，我不会替你填入理解。",
                  run_id: ctx.run_id,
                },
              },
            ],
            run_changes: { run_id: ctx.run_id, status: "waiting_user" },
            result: { outcome: JSON.stringify({ missing_fields: missing }) },
          };
        const prepared = await artifactWrite(
          this.repo,
          ctx.project_id,
          "learning_card",
          {
            ...card,
            goal_version: w.project.goal_version,
            claim_basis: "用户真实表达，独立掌握程度以检验证据为准",
          },
          evidenceIds,
        );
        return {
          entities: [prepared.entity],
          run_changes: { run_id: ctx.run_id, status: "running" },
          events: [
            {
              type: "artifact_committed",
              role: "curator",
              payload: {
                entity_id: prepared.ref.id,
                text: "只整理了你真实表达的学习卡",
              },
            },
          ],
          result: {
            outcome: JSON.stringify({
              id: prepared.ref.id,
              version: prepared.ref.version,
            }),
          },
        };
      },
    );
    const result = JSON.parse(String(receipt.result.outcome));
    if (result.id) {
      const card = (await this.workspace(ctx)).artifacts.find(
        (a) => a.id === result.id,
      )!;
      await this.scheduleReviews(ctx, {
        skill_id: JSON.parse(card.content).skill_id,
        learned_at: publicTimestamp(messages.at(-1)!.created_at),
        timezone: w.project.timezone,
      });
      await this.createIndex(ctx);
    }
    return result;
  }
  async scheduleReviews(
    ctx: ToolContext,
    input: { skill_id: string; learned_at: string; timezone: string },
  ) {
    authorizeTool(ctx, { type: "schedule_review" });
    const w = await this.workspace(ctx),
      dates = reviewDates(input.learned_at, input.timezone),
      key =
        "review_schedule:" +
        input.skill_id +
        ":" +
        localDate(input.learned_at, input.timezone),
      prior = await this.repo.readReceipt(
        ctx.project_id,
        ctx.operation_id,
        key,
      );
    if (prior)
      return JSON.parse(String(prior.result.refs)) as {
        id: string;
        due_date: string;
      }[];
    const refs = [
      {
        id: crypto.randomUUID(),
        due_date: dates.day1,
        offset: 1,
        form: "不看资料，重讲三句话",
      },
      {
        id: crypto.randomUUID(),
        due_date: dates.day3,
        offset: 3,
        form: "换一个例子，重新解释",
      },
    ];
    await this.commit(ctx, key, {
      entities: refs.map((r) => ({
        table: "review_schedule",
        row: {
          id: r.id,
          skill_id: input.skill_id,
          goal_version: w.project.goal_version,
          learned_date: localDate(input.learned_at, input.timezone),
          offset_days: r.offset,
          due_date: r.due_date,
          form: r.form,
          status: "pending",
          evidence_id:
            w.artifacts.filter((a) => a.kind === "learning_card").at(-1)?.id ??
            ctx.operation_id,
        },
      })),
      events: [
        {
          type: "handoff_committed",
          role: "curator",
          payload: {
            from: "curator",
            to: "supervisor",
            text: "已安排按项目时区的 +1 / +3 天复习",
          },
        },
        {
          type: "handoff_committed",
          role: "supervisor",
          payload: {
            from: "supervisor",
            to: "planner",
            text: "请将到期且未完成的复习纳入每日任务卡",
          },
        },
      ],
      result: { refs: JSON.stringify(refs) },
    });
    return refs;
  }
  async completeReview(ctx: ToolContext, id: string, text: string) {
    authorizeTool(ctx, { type: "schedule_review" });
    const w = await this.workspace(ctx),
      review = w.reviews.find((r) => r.id === id),
      message = w.messages.find(
        (m) =>
          m.run_id === ctx.run_id &&
          m.sender_role === "user" &&
          m.body === text,
      );
    if (
      !review ||
      !message ||
      Number(review.goal_version ?? 1) !== w.project.goal_version
    )
      throw new ApiError("REVISION_CONFLICT", 409);
    await this.commit(ctx, "review_complete:" + id, {
      review_changes: { id, status: "completed", evidence_id: message.id },
      run_changes: { run_id: ctx.run_id, status: "waiting_user" },
      events: [
        {
          type: "message_committed",
          role: "curator",
          payload: {
            entity_id: id,
            text: "复习表达已原样保存；这项复习已完成，不额外推断掌握程度",
          },
        },
      ],
    });
  }
  async submitUserArtifact(
    ctx: ToolContext,
    input: { kind: "draft" | "final"; text: string },
  ): Promise<ArtifactRef> {
    authorizeTool(ctx, { type: "write_artifact", kind: input.kind });
    const w = await this.workspace(ctx),
      m = w.messages.find(
        (m) =>
          m.run_id === ctx.run_id &&
          m.sender_role === "user" &&
          m.body === input.text,
      );
    if (!m) throw new ApiError("FORBIDDEN", 403);
    return commitArtifact(
      this.repo,
      { ...ctx, step_key: "submit_" + input.kind },
      input.kind,
      input.text,
      [m.id],
      { run_changes: { run_id: ctx.run_id, status: "running" } },
    );
  }
  async reviewDraft(ctx: ToolContext, ref: ArtifactRef): Promise<ArtifactRef> {
    authorizeTool(ctx, { type: "write_artifact", kind: "review_comments" });
    const w = await this.workspace(ctx),
      draft = w.artifacts.find(
        (a) =>
          a.id === ref.id && a.kind === "draft" && a.version === ref.version,
      );
    if (ref.project_id !== ctx.project_id || !draft)
      throw new ApiError("FORBIDDEN", 403);
    const paragraphs = draft.content.split(/\n\s*\n/);
    const key = "review_draft:" + ref.id;
    const receipt = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key,
        role: "coach",
        action: { type: "write_artifact", kind: "review_comments" },
        input: {
          draft_id: draft.id,
          paragraphs: paragraphs.map((text, i) => ({ index: i + 1, text })),
          output_contract: {
            comments: [
              {
                paragraph_index: "1-based index",
                quote: "literal passage",
                issue: "specific problem",
                action: "actionable suggestion only; no replacement paragraph",
              },
            ],
            fact_checks: [
              {
                quote: "literal passage",
                reason: "what to verify and where",
                status: "needs_manual_verification",
              },
            ],
          },
          professional_boundary:
            "医学、法律、金融只整理问题与查证清单，不做专业判断；所有不可核实事实标需人工查证，不代写",
        },
      },
      async (step) => {
        const r = await this.execute({
          project_id: ctx.project_id,
          run_id: ctx.run_id,
          epoch: ctx.epoch,
          step_key: key,
          role: "coach",
          action: "review_draft",
          evidence_ids: [draft.id],
          public_context: step.input,
        });
        const value = ReviewSchema.parse(r.content);
        if (
          value.comments.some(
            (c) => !paragraphs[c.paragraph_index - 1]?.includes(c.quote),
          ) ||
          value.fact_checks.some((f) => !draft.content.includes(f.quote))
        )
          throw new ApiError("MODEL_INVALID_RESULT", 422);
        return r;
      },
      async (r): Promise<StepWriteSet> => {
        const a = await artifactWrite(
          this.repo,
          ctx.project_id,
          "review_comments",
          {
            ...ReviewSchema.parse(r.content),
            draft_id: draft.id,
            boundary: "审稿意见与查证问题，不是代写或专业结论",
          },
        );
        return {
          entities: [a.entity],
          run_changes: { run_id: ctx.run_id, status: "waiting_user" },
          events: [
            {
              type: "handoff_committed",
              role: "coach",
              payload: {
                from: "coach",
                to: "supervisor",
                text: "具体段落审稿与人工查证清单已整理，最终取舍由你决定",
              },
            },
          ],
          result: { id: a.ref.id, version: a.ref.version },
        };
      },
    );
    return {
      id: String(receipt.result.id),
      version: Number(receipt.result.version),
      project_id: ctx.project_id,
      kind: "review_comments",
    };
  }
  async saveNote(
    ctx: ToolContext,
    text: string,
    base?: ArtifactRef,
  ): Promise<ArtifactRef> {
    authorizeTool(ctx, { type: "write_artifact", kind: "note" });
    const w = await this.workspace(ctx),
      m = w.messages.find(
        (m) =>
          m.run_id === ctx.run_id &&
          m.sender_role === "user" &&
          m.body === text,
      ),
      latest = w.artifacts.filter((a) => a.kind === "note").at(-1);
    const prior = await this.repo.readReceipt(
      ctx.project_id,
      ctx.operation_id,
      "note_save",
    );
    if (prior)
      return {
        project_id: ctx.project_id,
        id: String(prior.result.id),
        kind: "note",
        version: Number(prior.result.version),
      };
    if (!m) throw new ApiError("FORBIDDEN", 403);
    if (
      base &&
      (base.project_id !== ctx.project_id ||
        base.id !== latest?.id ||
        base.version !== latest?.version)
    )
      throw new ApiError("REVISION_CONFLICT", 409);
    return commitArtifact(
      this.repo,
      { ...ctx, step_key: "note_save" },
      "note",
      text,
      [m.id],
      { run_changes: { run_id: ctx.run_id, status: "running" } },
    );
  }
  async deleteNote(ctx: ToolContext, ref: ArtifactRef) {
    authorizeTool(ctx, { type: "write_artifact", kind: "note" });
    const w = await this.workspace(ctx),
      latest = w.artifacts.filter((a) => a.kind === "note").at(-1);
    if (
      ref.project_id !== ctx.project_id ||
      ref.id !== latest?.id ||
      ref.version !== latest.version ||
      latest.tombstone
    )
      throw new ApiError("REVISION_CONFLICT", 409);
    const a = await artifactWrite(this.repo, ctx.project_id, "note", "");
    a.entity.row.tombstone = 1;
    a.entity.row.supersedes_id = latest.id;
    await this.commit(ctx, "note_delete:" + ref.id, {
      entities: [a.entity],
      run_changes: { run_id: ctx.run_id, status: "waiting_user" },
      events: [
        {
          type: "artifact_committed",
          role: "curator",
          payload: {
            entity_id: a.ref.id,
            text: "笔记已标记删除，历史版本保留",
          },
        },
      ],
    });
  }
  async startWeeklyReview(ctx: ToolContext): Promise<PendingInput | null> {
    authorizeTool(ctx, { type: "write_artifact", kind: "weekly_report" });
    let w = await this.workspace(ctx);
    let session = w.sessions.find(
      (s) =>
        s.purpose === "weekly_review" &&
        Number(s.goal_version) === w.project.goal_version &&
        JSON.parse(String(s.question_ids_json)).some(
          (id: string) => !w.attempts.some((a) => a.question_id === id),
        ),
    );
    if (!session) {
      const id = crypto.randomUUID(),
        ids = WEEKLY_QUESTIONS.map(() => crypto.randomUUID());
      await this.commit(ctx, "weekly_session", {
        entities: [
          {
            table: "assessment_sessions",
            row: {
              id,
              purpose: "weekly_review",
              goal_version: w.project.goal_version,
              status: "active",
              question_ids_json: JSON.stringify(ids),
              required_skills_json: "[]",
            },
          },
          ...ids.map((qid, i): EntityWrite => ({
            table: "quiz_questions",
            row: {
              id: qid,
              session_id: id,
              version: 1,
              prompt: WEEKLY_QUESTIONS[i],
              skill_id: "weekly_review",
              kind: "reflection",
            },
          })),
        ],
      });
      w = await this.workspace(ctx);
      session = w.sessions.find((s) => s.id === id)!;
    }
    const ids = JSON.parse(String(session.question_ids_json)) as string[],
      id = ids.find((id) => !w.attempts.some((a) => a.question_id === id))!;
    const pending: PendingInput = {
      kind: "weekly_review",
      entity_id: id,
      version: 1,
      expected_role: "curator",
    };
    await this.commit(ctx, "weekly_present", {
      project_changes: {
        phase: "reviewing",
        pending_input_json: JSON.stringify(pending),
      },
      run_changes: { run_id: ctx.run_id, status: "waiting_user" },
      events: [
        {
          type: "question_presented",
          role: "curator",
          payload: { entity_id: id, text: WEEKLY_QUESTIONS[ids.indexOf(id)] },
        },
      ],
    });
    return pending;
  }
  async answerWeekly(
    ctx: ToolContext,
    text: string,
  ): Promise<PendingInput | null> {
    authorizeTool(ctx, { type: "write_artifact", kind: "weekly_report" });
    const prior = await this.repo.readReceipt(
      ctx.project_id,
      ctx.operation_id,
      "weekly_answer",
    );
    if (prior) {
      if (prior.result.pending) return JSON.parse(String(prior.result.pending));
      const w = await this.workspace(ctx),
        message = w.messages.find(
          (m) => m.run_id === ctx.run_id && m.sender_role === "user",
        ),
        attempt = w.attempts.find((a) => a.answer_message_id === message?.id),
        question = w.questions.find((q) => q.id === attempt?.question_id),
        sessionId = prior.result.session_id ?? question?.session_id;
      if (!sessionId) throw new ApiError("INVALID_STAGE", 409);
      await this.createWeeklyReport(ctx, String(sessionId));
      await this.createIndex(ctx);
      return null;
    }
    const w = await this.workspace(ctx),
      pending = w.project.pending_input_json
        ? JSON.parse(w.project.pending_input_json)
        : null,
      q = w.questions.find((q) => q.id === pending?.entity_id),
      s = w.sessions.find((s) => s.id === q?.session_id),
      m = w.messages.find(
        (m) =>
          m.run_id === ctx.run_id &&
          m.sender_role === "user" &&
          m.body === text,
      );
    if (
      pending?.kind !== "weekly_review" ||
      s?.purpose !== "weekly_review" ||
      !m ||
      Number(s.goal_version) !== w.project.goal_version
    )
      throw new ApiError("INVALID_STAGE", 409);
    const ids = JSON.parse(String(s.question_ids_json)) as string[],
      next = ids[ids.indexOf(String(q!.id)) + 1],
      after: PendingInput | null = next
        ? {
            kind: "weekly_review",
            entity_id: next,
            version: 1,
            expected_role: "curator",
          }
        : null;
    await this.commit(ctx, "weekly_answer", {
      entities: [
        {
          table: "quiz_attempts",
          row: {
            id: crypto.randomUUID(),
            question_id: String(q!.id),
            attempt_index: 1,
            answer_message_id: m.id,
          },
        },
      ],
      project_changes: {
        pending_input_json: after ? JSON.stringify(after) : null,
        phase: after ? "reviewing" : "learning",
      },
      run_changes: {
        run_id: ctx.run_id,
        status: after ? "waiting_user" : "running",
      },
      events: [
        {
          type: "question_presented",
          role: "curator",
          payload: {
            entity_id: next ?? String(s.id),
            text: next
              ? WEEKLY_QUESTIONS[ids.indexOf(next)]
              : "四问已收齐，整理可复算周报",
          },
        },
      ],
      result: {
        pending: after ? JSON.stringify(after) : null,
        session_id: String(s.id),
      },
    });
    if (!after) {
      await this.createWeeklyReport(ctx, String(s.id));
      await this.createIndex(ctx);
    }
    return after;
  }
  async createWeeklyReport(
    ctx: ToolContext,
    sessionId: string,
  ): Promise<ArtifactRef> {
    authorizeTool(ctx, { type: "write_artifact", kind: "weekly_report" });
    const w = await this.workspace(ctx),
      s = w.sessions.find(
        (s) => s.id === sessionId && s.purpose === "weekly_review",
      );
    if (!s) throw new ApiError("FORBIDDEN", 403);
    const ids = JSON.parse(String(s.question_ids_json)) as string[],
      answers = ids.map((id) => {
        const a = w.attempts.find((a) => a.question_id === id);
        return {
          question_id: id,
          prompt: w.questions.find((q) => q.id === id)?.prompt,
          message_id: a?.answer_message_id,
          text:
            a?.answer_text ??
            w.messages.find((m) => m.id === a?.answer_message_id)?.body,
        };
      });
    if (answers.some((a) => !a.message_id || typeof a.text !== "string"))
      throw new ApiError("INVALID_STAGE", 409);
    return commitArtifact(
      this.repo,
      { ...ctx, step_key: "weekly_report:" + sessionId },
      "weekly_report",
      { goal_version: w.project.goal_version, answers, ...quizStatistics(w) },
      answers.map((a) => String(a.message_id)),
      { run_changes: { run_id: ctx.run_id, status: "waiting_user" } },
    );
  }
  async createIndex(ctx: ToolContext) {
    authorizeTool(ctx, { type: "write_artifact", kind: "index" });
    const w = await this.workspace(ctx);
    return commitArtifact(
      this.repo,
      { ...ctx, step_key: "archive_index" },
      "index",
      {
        entries: w.artifacts
          .filter((a) => a.kind !== "index")
          .map((a) => ({
            id: a.id,
            kind: a.kind,
            version: a.version,
            deleted: !!a.tombstone,
          })),
        ...quizStatistics(w),
      },
      [],
      { run_changes: { run_id: ctx.run_id, status: "waiting_user" } },
    );
  }
}
