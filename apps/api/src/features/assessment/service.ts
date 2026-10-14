import { z } from "zod";
import { ProjectRepository } from "../../db/repository";
import type {
  WorkspaceRecord,
  EntityWrite,
  StepWriteSet,
} from "../../db/types";
import type { ToolContext } from "../../runtime/tool-context";
import type { RoleExecutor } from "../planning/service";
import { TaskRunner } from "../../runtime/runner";
import { ApiError } from "../../http/errors";
import { computeCompletion } from "../../domain/assessment";
import type { AssessmentPolicy, CompletionEvidenceInput } from "./types";
const text = z.string().min(1).max(2000);
export const PolicyDraftSchema = z
  .object({
    question_count: z.number().int().min(1).max(50),
    required_skill_ids: z.array(text).min(1).max(30),
    rubric: z
      .object({
        correct_criteria: z.array(text).min(1),
        uncertain_rule: z.literal("needs_review"),
      })
      .strict(),
    partial_rule: z.enum(["count_correct", "count_incorrect"]),
    attempt_basis: z.enum(["first", "after_correction"]),
    aggregation: z.enum(["single_session", "multi_session"]),
    session_count: z.number().int().min(1).max(5),
  })
  .strict();
const EvaluationSchema = z
  .object({
    verdict: z.enum(["correct", "incorrect", "partial", "needs_review"]),
    gap_category: z.enum([
      "concept_confusion",
      "missing_evidence",
      "boundary",
      "reasoning",
      "transfer",
      "none",
    ]),
    gap: z.string().max(2000),
    evidence_quote: z.string().max(2000),
  })
  .strict();
const QuestionsSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            prompt: text,
            reference_answer: text,
            explanation: text,
            rubric: z.object({ criteria: z.array(text).min(1) }).strict(),
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict();
const followups = {
  concept_confusion: "请重新用自己的话解释涉及的概念，并说明它们之间的区别。",
  missing_evidence: "你能给出一个具体例子，说明你的判断依据吗？",
  boundary: "这个判断在什么条件下成立？请举一个不成立的情况。",
  reasoning: "请逐步说明你的推理过程，每一步依据是什么？",
  transfer: "换一个应用场景，你会怎样使用这个思路？",
  none: "请用一个具体例子进一步说明你的回答。",
};
export interface AttemptRef {
  id: string;
  question_id: string;
  attempt_index: number;
}
function confirmed(w: WorkspaceRecord): AssessmentPolicy | null {
  const row = [...w.policies].reverse().find((p) => p.status === "confirmed");
  return row ? JSON.parse(String(row.policy_json)) : null;
}
export function completionInput(
  w: WorkspaceRecord,
  active: string,
): CompletionEvidenceInput {
  return {
    goal_version: w.project.goal_version,
    active_session_id: active,
    sessions: w.sessions.map((s) => ({
      id: String(s.id),
      purpose: s.purpose as "practice" | "completion" | "diagnostic",
      goal_version: Number(s.goal_version),
      policy_version:
        s.policy_version == null ? null : Number(s.policy_version),
      question_ids: JSON.parse(String(s.question_ids_json)),
    })),
    questions: w.questions.map((q) => ({
      id: String(q.id),
      session_id: String(q.session_id),
      skill_id: String(q.skill_id),
      attempts: w.attempts
        .filter((a) => a.question_id === q.id)
        .map((a) => ({
          id: String(a.id),
          index: Number(a.attempt_index),
          verdict:
            (w.evaluations.filter((e) => e.attempt_id === a.id).at(-1)
              ?.verdict as
              "correct" | "incorrect" | "partial" | "needs_review" | null) ??
            null,
        })),
    })),
  };
}
export class AssessmentService {
  constructor(
    private repo: ProjectRepository,
    private execute: RoleExecutor,
  ) {}
  private async commit(
    ctx: ToolContext,
    key: string,
    writes: Parameters<ProjectRepository["commitStep"]>[1],
  ) {
    const p = await this.repo.getProject(ctx.owner_id, ctx.project_id);
    return this.repo.commitStep(
      { ...ctx, step_key: key, base_revision: p.revision },
      writes,
    );
  }
  async submit(
    ctx: ToolContext,
    input: {
      question_id: string;
      question_version: number;
      attempt_index: number;
      text: string;
    },
  ): Promise<AttemptRef> {
    const w = await this.repo.readWorkspace(ctx.project_id);
    await this.repo.getProject(ctx.owner_id, ctx.project_id);
    const q = w.questions.find((q) => q.id === input.question_id),
      s = w.sessions.find((s) => s.id === q?.session_id),
      pending = w.project.pending_input_json
        ? JSON.parse(w.project.pending_input_json)
        : null;
    if (
      !q ||
      Number(q.version) !== input.question_version ||
      Number(s?.goal_version) !== w.project.goal_version
    )
      throw new ApiError("REVISION_CONFLICT", 409);
    const message = w.messages.find(
      (m) =>
        m.run_id === ctx.run_id &&
        m.sender_role === "user" &&
        m.body === input.text,
    );
    if (!message) throw new ApiError("FORBIDDEN", 403);
    const prior = w.attempts.find(
      (a) => a.question_id === q.id && a.attempt_index === input.attempt_index,
    );
    if (prior) {
      if (prior.answer_message_id !== message.id)
        throw new ApiError("REVISION_CONFLICT", 409);
      return {
        id: String(prior.id),
        question_id: String(q.id),
        attempt_index: input.attempt_index,
      };
    }
    const attempts = w.attempts.filter((a) => a.question_id === q.id),
      last = attempts.at(-1),
      evaluation = w.evaluations
        .filter((e) => e.attempt_id === last?.id)
        .at(-1);
    if (
      pending?.kind !== "answer" ||
      pending.entity_id !== q.id ||
      input.attempt_index !== attempts.length + 1 ||
      input.attempt_index > 2 ||
      (last && (!evaluation || !evaluation.followup))
    )
      throw new ApiError("INVALID_STAGE", 409);
    const id = crypto.randomUUID();
    await this.commit(
      { ...ctx, actor: "trusted_ingress" },
      `answer:${q.id}:${input.attempt_index}`,
      {
        entities: [
          {
            table: "quiz_attempts",
            row: {
              id,
              question_id: String(q.id),
              attempt_index: input.attempt_index,
              answer_message_id: message.id,
            },
          },
        ],
        result: { id },
      },
    );
    return {
      id,
      question_id: String(q.id),
      attempt_index: input.attempt_index,
    };
  }
  async evaluate(
    ctx: ToolContext,
    attempt: AttemptRef,
  ): Promise<{ id: string; reveal_allowed: boolean; verdict: string }> {
    const w = await this.repo.readWorkspace(ctx.project_id),
      a = w.attempts.find((a) => a.id === attempt.id),
      q = w.questions.find((q) => q.id === a?.question_id),
      s = w.sessions.find((s) => s.id === q?.session_id),
      secret = w.secrets.find((x) => x.question_id === q?.id),
      answer = w.messages.find((m) => m.id === a?.answer_message_id);
    if (
      !a ||
      !q ||
      !s ||
      !secret ||
      !answer ||
      Number(s.goal_version) !== w.project.goal_version
    )
      throw new ApiError("FORBIDDEN", 403);
    const key = `grade:${a.id}`,
      prior = w.evaluations.filter((e) => e.attempt_id === a.id).at(-1);
    if (prior)
      return {
        id: String(prior.id),
        reveal_allowed: !!prior.reveal_allowed,
        verdict: String(prior.verdict),
      };
    const result = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key,
        role: "coach",
        action: { type: "grade_answer" },
        input: {
          question_id: q.id,
          answer_id: answer.id,
          answer: answer.body,
          prompt: q.prompt,
          attempt_index: a.attempt_index,
          output_contract: {
            verdict: "correct | incorrect | partial | needs_review",
            gap_category:
              "concept_confusion | missing_evidence | boundary | reasoning | transfer | none",
            gap: "private grading notes",
            evidence_quote: "literal quote from learner answer",
          },
        },
      },
      async (step) => {
        const result = await this.execute({
          project_id: ctx.project_id,
          run_id: ctx.run_id,
          epoch: ctx.epoch,
          step_key: key,
          role: "coach",
          action: "evaluate",
          evidence_ids: [answer.id],
          public_context: step.input,
          private_context: {
            reference_answer: secret.reference_answer,
            rubric: JSON.parse(String(secret.rubric_json)),
          },
        });
        EvaluationSchema.parse(result.content);
        return result;
      },
      async (result): Promise<StepWriteSet> => {
        const e = EvaluationSchema.parse(result.content),
          reveal = Number(a.attempt_index) === 2 || e.verdict === "correct",
          followup =
            !reveal && e.verdict !== "needs_review"
              ? followups[e.gap_category]
              : null,
          id = crypto.randomUUID();
        // Free-form grading notes are private; the first response uses only bounded labels.
        const feedback =
          e.verdict === "needs_review"
            ? "这次判断需要复核，暂不计为正确或错误。"
            : reveal
              ? `${e.verdict === "correct" ? "回答正确。" : "本次回答已记录。"}\n${secret.explanation}`
              : `还有需要补充的地方。${followup}`;
        const current = await this.repo.readWorkspace(ctx.project_id),
          virtual = {
            ...current,
            evaluations: [
              ...current.evaluations,
              { id, attempt_id: String(a.id), verdict: e.verdict },
            ],
          },
          policy = confirmed(current),
          completion = computeCompletion(
            policy,
            completionInput(virtual, String(s.id)),
          );
        let next = String(q.id);
        if (reveal) {
          const ids = JSON.parse(String(s.question_ids_json)) as string[];
          next =
            ids.find(
              (qid) =>
                !virtual.attempts.some(
                  (at) =>
                    at.question_id === qid &&
                    virtual.evaluations.some(
                      (ev) =>
                        ev.attempt_id === at.id &&
                        (ev.verdict === "correct" ||
                          Number(at.attempt_index) === 2),
                    ),
                ),
            ) ?? "";
        }
        const pending = next
          ? JSON.stringify({
              kind: "answer",
              entity_id: next,
              version: 1,
              expected_role: "coach",
            })
          : null;
        return {
          entities: [
            {
              table: "quiz_evaluations",
              row: {
                id,
                attempt_id: String(a.id),
                policy_version: s.policy_version,
                verdict: e.verdict,
                gap: e.gap_category,
                feedback,
                followup,
                reveal_allowed: reveal ? 1 : 0,
              },
            },
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: "coach",
                body: feedback,
                run_id: ctx.run_id,
              },
            },
          ],
          project_changes: {
            pending_input_json: pending,
            ...(s.purpose === "completion"
              ? {
                  completion_json: JSON.stringify(completion),
                  phase:
                    completion.status === "met"
                      ? ("completed" as const)
                      : ("completion_check" as const),
                }
              : {
                  phase: next ? ("practicing" as const) : ("learning" as const),
                }),
          },
          run_changes: { run_id: ctx.run_id, status: "waiting_user" },
          events: [
            {
              type: "feedback_committed",
              role: "coach",
              run_id: ctx.run_id,
              payload: { text: feedback, entity_id: id },
            },
            ...(reveal
              ? [
                  {
                    type: "handoff_committed" as const,
                    role: "coach" as const,
                    run_id: ctx.run_id,
                    payload: {
                      from: "coach" as const,
                      to: "supervisor" as const,
                      entity_id: id,
                      text: "答题反馈已交给总管，后续计划由规划师处理",
                    },
                  },
                ]
              : []),
          ],
          result: { id, reveal_allowed: reveal ? 1 : 0, verdict: e.verdict },
        };
      },
    );
    return {
      id: String(result.result.id),
      reveal_allowed: !!result.result.reveal_allowed,
      verdict: String(result.result.verdict),
    };
  }
  async proposePolicy(ctx: ToolContext) {
    const w = await this.repo.readWorkspace(ctx.project_id),
      definition = w.artifacts.filter((a) => a.kind === "definition").at(-1);
    if (
      !definition ||
      (JSON.parse(definition.content).goal_text &&
        JSON.parse(definition.content).goal_text !== w.project.goal_text)
    )
      throw new ApiError("INVALID_STAGE", 409);
    const existing = w.policies.at(-1);
    if (
      existing &&
      JSON.parse(String(existing.policy_json)).goal_version ===
        w.project.goal_version
    )
      return { id: String(existing.id), version: Number(existing.version) };
    const skills = JSON.parse(definition.content).skills as string[];
    const key = "assessment_policy";
    const receipt = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key,
        role: "coach",
        action: { type: "present_question" },
        input: {
          skills,
          output_contract: {
            question_count: "integer 1-50 and at least number of skills",
            required_skill_ids: skills,
            rubric: {
              correct_criteria: ["observable criteria"],
              uncertain_rule: "needs_review",
            },
            partial_rule: "count_correct | count_incorrect",
            attempt_basis: "first | after_correction",
            aggregation: "single_session | multi_session",
            session_count: "1-5",
          },
        },
      },
      async (step) => {
        const r = await this.execute({
          project_id: ctx.project_id,
          run_id: ctx.run_id,
          epoch: ctx.epoch,
          step_key: key,
          role: "coach",
          action: "assessment_policy",
          evidence_ids: [],
          public_context: step.input,
        });
        const value = PolicyDraftSchema.parse(r.content);
        if (
          value.question_count < skills.length ||
          skills.some((s) => !value.required_skill_ids.includes(s)) ||
          value.required_skill_ids.some((s) => !skills.includes(s))
        )
          throw new ApiError("MODEL_INVALID_RESULT", 422);
        return r;
      },
      (r): StepWriteSet => {
        const d = PolicyDraftSchema.parse(r.content),
          id = crypto.randomUUID(),
          version = Number(existing?.version ?? 0) + 1,
          policy: AssessmentPolicy = {
            ...d,
            id,
            version,
            status: "draft",
            goal_version: w.project.goal_version,
            session_selection: Array.from(
              {
                length:
                  d.aggregation === "single_session" ? 1 : d.session_count,
              },
              () => crypto.randomUUID(),
            ),
            confirmed_message_id: null,
          };
        return {
          entities: [
            {
              table: "assessment_policies",
              row: {
                id,
                version,
                status: "draft",
                policy_json: JSON.stringify(policy),
              },
            },
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: "coach",
                body: "完成检验政策已拟定，请在政策卡中确认题数、覆盖、评分规则与答案口径。确认前不判定完成。",
                run_id: ctx.run_id,
              },
            },
          ],
          run_changes: { run_id: ctx.run_id, status: "waiting_user" },
          project_changes: { pending_input_json: null },
          result: { id, version },
        };
      },
    );
    return {
      id: String(receipt.result.id),
      version: Number(receipt.result.version),
    };
  }
  async confirmPolicy(
    ctx: ToolContext,
    input: { policy_id: string; policy_version: number },
  ) {
    const w = await this.repo.readWorkspace(ctx.project_id),
      p = w.policies.find((p) => p.id === input.policy_id),
      message = w.messages.find(
        (m) => m.run_id === ctx.run_id && m.sender_role === "user",
      );
    if (
      !p ||
      Number(p.version) !== input.policy_version ||
      !message ||
      p.id !== w.policies.at(-1)?.id
    )
      throw new ApiError("REVISION_CONFLICT", 409);
    if (p.status === "confirmed") return;
    const policy = JSON.parse(String(p.policy_json)) as AssessmentPolicy;
    if (policy.goal_version !== w.project.goal_version)
      throw new ApiError("REVISION_CONFLICT", 409);
    policy.status = "confirmed";
    policy.confirmed_message_id = message.id;
    await this.commit({ ...ctx, actor: "trusted_ingress" }, "confirm_policy", {
      policy_changes: {
        id: String(p.id),
        status: "confirmed",
        confirmed_message_id: message.id,
        policy_json: JSON.stringify(policy),
      },
      run_changes: { run_id: ctx.run_id, status: "waiting_user" },
      events: [
        {
          type: "message_committed",
          role: "supervisor",
          payload: { text: "测验政策已按用户选择确认，完成门槛为 80%" },
        },
      ],
    });
  }
  async start(ctx: ToolContext, purpose: "practice" | "completion") {
    let w = await this.repo.readWorkspace(ctx.project_id);
    const definition = w.artifacts
      .filter((a) => a.kind === "definition")
      .at(-1);
    if (
      !definition ||
      (JSON.parse(definition.content).goal_text &&
        JSON.parse(definition.content).goal_text !== w.project.goal_text)
    )
      throw new ApiError("INVALID_STAGE", 409);
    const skills = JSON.parse(definition.content).skills as string[],
      policy = confirmed(w);
    if (
      purpose === "completion" &&
      (!policy || policy.goal_version !== w.project.goal_version)
    ) {
      await this.proposePolicy(ctx);
      return null;
    }
    let session = w.sessions.find(
      (s) =>
        s.purpose === purpose &&
        Number(s.goal_version) === w.project.goal_version &&
        s.status === "active" &&
        (purpose !== "completion" || s.policy_id === policy!.id) &&
        !JSON.parse(String(s.question_ids_json)).every((qid: string) =>
          w.attempts.some(
            (a) =>
              a.question_id === qid &&
              w.evaluations.some(
                (e) =>
                  e.attempt_id === a.id &&
                  (e.verdict === "correct" || Number(a.attempt_index) === 2),
              ),
          ),
        ),
    );
    if (!session) {
      const selected =
        purpose === "completion"
          ? (policy!.session_selection.find(
              (id) => !w.sessions.some((s) => s.id === id),
            ) ??
            (policy!.aggregation === "single_session"
              ? crypto.randomUUID()
              : undefined))
          : undefined;
      if (purpose === "completion" && !selected) {
        const completion = computeCompletion(
          policy,
          completionInput(w, String(w.sessions.at(-1)?.id)),
        );
        await this.commit(ctx, "completion_snapshot", {
          project_changes: {
            completion_json: JSON.stringify(completion),
            phase:
              completion.status === "met" ? "completed" : "completion_check",
          },
          run_changes: { run_id: ctx.run_id, status: "waiting_user" },
        });
        return null;
      }
      const id = selected ?? crypto.randomUUID(),
        count = purpose === "completion" ? policy!.question_count : 4,
        required =
          purpose === "completion"
            ? policy!.required_skill_ids
            : skills.slice(0, 4),
        ids = Array.from({ length: count }, () => crypto.randomUUID());
      await this.commit(ctx, `session:${id}`, {
        entities: [
          {
            table: "assessment_sessions",
            row: {
              id,
              purpose,
              goal_version: w.project.goal_version,
              policy_id: purpose === "completion" ? policy!.id : null,
              policy_version: purpose === "completion" ? policy!.version : null,
              status: "active",
              question_ids_json: JSON.stringify(ids),
              required_skills_json: JSON.stringify(required),
            },
          },
        ],
      });
      w = await this.repo.readWorkspace(ctx.project_id);
      session = w.sessions.find((s) => s.id === id)!;
    }
    const ids = JSON.parse(String(session.question_ids_json)) as string[],
      required = JSON.parse(String(session.required_skills_json)) as string[];
    let batches = 0;
    for (let offset = 0; offset < ids.length; offset += 2) {
      const slice = ids.slice(offset, offset + 2);
      if (slice.every((id) => w.questions.some((q) => q.id === id))) continue;
      if (batches++ === 4) {
        await this.commit(ctx, "question_generation_checkpoint", {
          run_changes: { run_id: ctx.run_id, status: "waiting_dependency" },
          entities: [
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: "coach",
                body: "题目已分批保存。再次点击开始检验可继续生成剩余题目，完整题清单就绪后再答题。",
              },
            },
          ],
        });
        return null;
      }
      const key = `questions:${session.id}:${offset}`,
        specs = slice.map((id, i) => ({
          id,
          skill_id: required[(offset + i) % required.length],
          kind:
            purpose === "practice" && offset + i === 3
              ? "application"
              : ["concept", "compare", "application"][(offset + i) % 3],
        }));
      await new TaskRunner(this.repo).executeStep(
        ctx,
        ctx.run_id,
        {
          key,
          role: "coach",
          action: { type: "present_question" },
          input: {
            definition: JSON.parse(definition.content),
            questions: specs,
            output_contract: {
              questions: specs.map(() => ({
                prompt: "question without answer",
                reference_answer: "private reference",
                explanation: "private explanation",
                rubric: { criteria: ["observable criterion"] },
              })),
            },
          },
        },
        async (step) => {
          const r = await this.execute({
            project_id: ctx.project_id,
            run_id: ctx.run_id,
            epoch: ctx.epoch,
            step_key: key,
            role: "coach",
            action: "questions",
            evidence_ids: [],
            public_context: step.input,
          });
          if (
            QuestionsSchema.parse(r.content).questions.length !== specs.length
          )
            throw new ApiError("MODEL_INVALID_RESULT", 422);
          return r;
        },
        (r) => ({
          entities: QuestionsSchema.parse(r.content).questions.flatMap(
            (q, i): EntityWrite[] => [
              {
                table: "quiz_questions",
                row: {
                  id: specs[i].id,
                  session_id: String(session!.id),
                  version: 1,
                  prompt: q.prompt,
                  skill_id: specs[i].skill_id,
                  kind: specs[i].kind,
                },
              },
              {
                table: "question_secrets",
                row: {
                  question_id: specs[i].id,
                  reference_answer: q.reference_answer,
                  rubric_json: JSON.stringify(q.rubric),
                  explanation: q.explanation,
                },
              },
            ],
          ),
        }),
      );
      w = await this.repo.readWorkspace(ctx.project_id);
    }
    const next = ids.find(
      (qid) =>
        !w.attempts.some(
          (a) =>
            a.question_id === qid &&
            w.evaluations.some(
              (e) =>
                e.attempt_id === a.id &&
                (e.verdict === "correct" || Number(a.attempt_index) === 2),
            ),
        ),
    )!;
    await this.commit(ctx, `present:${session.id}`, {
      project_changes: {
        phase: purpose === "completion" ? "completion_check" : "practicing",
        pending_input_json: JSON.stringify({
          kind: "answer",
          entity_id: next,
          version: 1,
          expected_role: "coach",
        }),
      },
      run_changes: { run_id: ctx.run_id, status: "waiting_user" },
      events: [
        {
          type: "question_presented",
          role: "coach",
          payload: { entity_id: next, text: "请先独立回答，再查看反馈" },
        },
      ],
    });
    return { id: String(session.id) };
  }
}
