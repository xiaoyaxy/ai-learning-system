import { AdjustmentService, type DecideProposal } from "./adjustment";
import { z } from "zod";
import type { RoleTask, RoleResult } from "../../runtime/types";
import type { ToolContext } from "../../runtime/tool-context";
import type { ArtifactRef } from "../../db/types";
import { ProjectRepository } from "../../db/repository";
import { TaskRunner } from "../../runtime/runner";
import { ApiError } from "../../http/errors";
import { authorizeTool } from "../../domain/permissions";
import { artifactWrite, commitArtifact } from "../artifacts";
const line = z.string().min(1).max(1000);
export const DefinitionSchema = z
  .object({
    purpose: line,
    scope_in: z.array(line).min(1).max(30),
    scope_out: z.array(line).min(1).max(30),
    skills: z.array(line).min(1).max(30),
    first_draft_milestone: z
      .object({
        suggested_days: z.number().int().min(1).max(2),
        description: line,
      })
      .strict(),
  })
  .strict();
const ScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("question"),
      question: line,
      missing_fields: z.array(line),
    })
    .strict(),
  z
    .object({ kind: z.literal("definition"), definition: DefinitionSchema })
    .strict(),
]);
const PlanSchema = z
  .object({
    milestones: z.array(line).min(1),
    tasks: z
      .array(
        z
          .object({
            goal: line,
            skill_id: line,
            material_ids: z.array(z.string()).min(1),
            output: line,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const CardSchema = z
  .object({
    goal: line,
    material_ids: z.array(z.string()).min(1),
    output: line,
    blocks: z
      .array(
        z
          .object({
            kind: z.enum(["deep", "supplement", "reflection"]),
            activity: line,
          })
          .strict(),
      )
      .length(3),
  })
  .strict();
export type ProjectDefinition = z.infer<typeof DefinitionSchema> & {
  time_constraint_text: string;
  time_setting: null;
};
export interface ScopeResult {
  kind: "question" | "definition" | "missing_fields";
  artifact?: ArtifactRef;
  question?: string;
  missing_fields?: string[];
}
export type RoleExecutor = (task: RoleTask) => Promise<RoleResult>;
export class PlanningService {
  constructor(
    private repo: ProjectRepository,
    private execute: RoleExecutor,
  ) {}
  async proposeAdjustment(ctx: ToolContext, id: string) {
    return new AdjustmentService(this.repo, this.execute).proposeAdjustment(
      ctx,
      id,
    );
  }
  async recordDecision(ctx: ToolContext, input: DecideProposal) {
    return new AdjustmentService(this.repo, this.execute).recordDecision(
      ctx,
      input,
    );
  }
  private task(
    ctx: ToolContext,
    key: string,
    action: string,
    input: Record<string, unknown>,
  ): RoleTask {
    return {
      project_id: ctx.project_id,
      run_id: ctx.run_id,
      epoch: ctx.epoch,
      step_key: key,
      role: "planner",
      action,
      evidence_ids: [],
      public_context: input,
    };
  }
  async scope(
    ctx: ToolContext,
    input: { message_id: string },
  ): Promise<ScopeResult> {
    authorizeTool(ctx, { type: "write_artifact", kind: "definition" });
    const w = await this.repo.readWorkspace(ctx.project_id),
      message = w.messages.find(
        (m) => m.id === input.message_id && m.sender_role === "user",
      );
    if (!message) throw new ApiError("FORBIDDEN", 403);
    const stepKey = `scope:${input.message_id}`;
    let outcome: ScopeResult | undefined;
    const receipt = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key: stepKey,
        role: "planner",
        action: { type: "write_artifact", kind: "definition" },
        input: {
          goal: w.project.goal_text,
          time_constraint_text: w.project.time_constraint_text,
          messages: w.messages
            .filter((m) => m.sender_role === "user")
            .map((m) => ({ id: m.id, text: m.body })),
          clarification_count: w.project.scope_questions,
          output_contract: {
            kind: "question | definition",
            question: "one question when facts missing",
            missing_fields: ["missing fact names"],
            definition: {
              purpose: "string",
              scope_in: ["string"],
              scope_out: ["string"],
              skills: ["string"],
              first_draft_milestone: {
                suggested_days: "1 or 2",
                description: "string",
              },
            },
          },
        },
      },
      async (step) => {
        const result = await this.execute(
          this.task(ctx, stepKey, "scope", step.input),
        );
        ScopeSchema.parse(result.content);
        return result;
      },
      async (result) => {
        const parsed = ScopeSchema.parse(result.content),
          current = await this.repo.readWorkspace(ctx.project_id);
        if (parsed.kind === "question") {
          const atLimit = current.project.scope_questions >= 3,
            text = atLimit
              ? `仍缺少：${parsed.missing_fields.join("、")}。可以直接补充这些信息；暂不进入教学。`
              : parsed.question;
          outcome = atLimit
            ? { kind: "missing_fields", missing_fields: parsed.missing_fields }
            : { kind: "question", question: text };
          const id = crypto.randomUUID();
          return {
            entities: [
              {
                table: "messages",
                row: {
                  id,
                  sender_role: "planner",
                  body: text,
                  run_id: ctx.run_id,
                },
              },
            ],
            project_changes: {
              phase: "scoping",
              scope_questions: atLimit
                ? 3
                : current.project.scope_questions + 1,
              pending_input_json: JSON.stringify({
                kind: "scope",
                entity_id: id,
                version: 1,
                expected_role: "planner",
              }),
            },
            run_changes: { run_id: ctx.run_id, status: "waiting_user" },
            events: [
              {
                type: "message_committed",
                role: "planner",
                run_id: ctx.run_id,
                payload: { text },
              },
            ],
            result: { outcome: JSON.stringify(outcome) },
          };
        }
        const definition = {
            ...parsed.definition,
            goal_version: current.project.goal_version,
            goal_text: current.project.goal_text,
            time_constraint_text: current.project.time_constraint_text,
            time_setting: null,
          },
          prepared = await artifactWrite(
            this.repo,
            ctx.project_id,
            "definition",
            definition,
            [message.id],
          );
        outcome = { kind: "definition", artifact: prepared.ref };
        const text =
          "学习范围与第一版成果方向已整理。请用自己的话说说你现在的理解、已知词汇和困惑。";
        return {
          entities: [
            prepared.entity,
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: "planner",
                body: text,
                run_id: ctx.run_id,
              },
            },
          ],
          project_changes: {
            phase: "diagnosis",
            pending_input_json: JSON.stringify({
              kind: "diagnosis",
              entity_id: prepared.ref.id,
              version: prepared.ref.version,
              expected_role: "planner",
            }),
          },
          run_changes: { run_id: ctx.run_id, status: "waiting_user" },
          events: [
            {
              type: "artifact_committed",
              role: "planner",
              run_id: ctx.run_id,
              payload: { entity_id: prepared.ref.id, text: "项目定义" },
            },
            {
              type: "message_committed",
              role: "planner",
              run_id: ctx.run_id,
              payload: { text },
            },
          ],
          result: { outcome: JSON.stringify(outcome) },
        };
      },
    );
    return (
      outcome ?? (JSON.parse(String(receipt.result.outcome)) as ScopeResult)
    );
  }
  async saveDiagnosis(
    ctx: ToolContext,
    messageId: string,
  ): Promise<ArtifactRef> {
    authorizeTool(ctx, { type: "write_artifact", kind: "diagnosis" });
    const w = await this.repo.readWorkspace(ctx.project_id),
      message = w.messages.find(
        (m) => m.id === messageId && m.sender_role === "user",
      );
    if (!message) throw new ApiError("FORBIDDEN", 403);
    const existing = w.artifacts.find((a) => a.kind === "diagnosis");
    if (existing)
      return {
        project_id: ctx.project_id,
        id: existing.id,
        kind: "diagnosis",
        version: existing.version,
      };
    return commitArtifact(
      this.repo,
      { ...ctx, step_key: "diagnosis" },
      "diagnosis",
      message.body,
      [message.id],
      {
        project_changes: { phase: "preparing", pending_input_json: null },
        run_changes: { run_id: ctx.run_id, status: "running" },
      },
    );
  }
  async createPlan(
    ctx: ToolContext,
    input: {
      definition_id: string;
      source_ids: string[];
      review_ids: string[];
    },
  ): Promise<ArtifactRef> {
    authorizeTool(ctx, { type: "write_artifact", kind: "plan" });
    const w = await this.repo.readWorkspace(ctx.project_id),
      definition = w.artifacts.find(
        (a) => a.id === input.definition_id && a.kind === "definition",
      );
    if (!definition) throw new ApiError("INVALID_STAGE", 409);
    if (
      !input.source_ids.length ||
      input.source_ids.some((id) => !w.sources.some((s) => s.id === id))
    )
      throw new ApiError("SOURCE_UNAVAILABLE", 409);
    let ref: ArtifactRef | undefined;
    const receipt = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key: "plan",
        role: "planner",
        action: { type: "write_artifact", kind: "plan" },
        input: {
          definition: JSON.parse(definition.content),
          materials: w.sources
            .filter((s) => input.source_ids.includes(String(s.id)))
            .map((s) => ({
              id: s.id,
              reference_no: s.reference_no,
              title: s.title,
              summary: s.summary,
            })),
          review_ids: input.review_ids,
          output_contract: {
            milestones: ["string"],
            tasks: [
              {
                goal: "string",
                skill_id: "definition skill",
                material_ids: ["provided material ID"],
                output: "user output",
              },
            ],
          },
        },
      },
      async (step) => {
        const r = await this.execute(
            this.task(ctx, "plan", "plan", step.input),
          ),
          parsed = PlanSchema.parse(r.content);
        if (
          parsed.tasks.some((t) =>
            t.material_ids.some((id) => !input.source_ids.includes(id)),
          )
        )
          throw new ApiError("MODEL_INVALID_RESULT", 422);
        return r;
      },
      async (r) => {
        const value = {
            ...PlanSchema.parse(r.content),
            time_setting: null,
            time_constraint_text: w.project.time_constraint_text,
            review_ids: input.review_ids,
          },
          prepared = await artifactWrite(
            this.repo,
            ctx.project_id,
            "plan",
            value,
          );
        ref = prepared.ref;
        return {
          entities: [prepared.entity],
          project_changes: { active_plan_id: ref.id, phase: "learning" },
          events: [
            {
              type: "plan_activated",
              role: "planner",
              run_id: ctx.run_id,
              payload: {
                entity_id: ref.id,
                text: "学习计划已生成，保留原时间约束",
              },
            },
          ],
          result: { id: ref.id, version: ref.version },
        };
      },
    );
    return (
      ref ?? {
        project_id: ctx.project_id,
        id: String(receipt.result.id),
        kind: "plan",
        version: Number(receipt.result.version),
      }
    );
  }
  async createTaskCard(
    ctx: ToolContext,
    localDate: string,
  ): Promise<ArtifactRef> {
    authorizeTool(ctx, { type: "write_artifact", kind: "task_card" });
    const w = await this.repo.readWorkspace(ctx.project_id),
      plan = w.artifacts.find((a) => a.id === w.project.active_plan_id);
    if (!plan) throw new ApiError("INVALID_STAGE", 409);
    const reviews = w.reviews.filter(
      (r) =>
        r.due_date && String(r.due_date) <= localDate && r.status === "pending",
    );
    let ref: ArtifactRef | undefined;
    const key = `task_card:${localDate}`;
    const receipt = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key,
        role: "planner",
        action: { type: "write_artifact", kind: "task_card" },
        input: {
          plan: JSON.parse(plan.content),
          date: localDate,
          review_items: reviews,
          output_contract: {
            goal: "string",
            material_ids: ["source id"],
            output: "user output",
            blocks: [
              { kind: "deep", activity: "string" },
              { kind: "supplement", activity: "string" },
              { kind: "reflection", activity: "string" },
            ],
          },
        },
      },
      async (step) => {
        const r = await this.execute(
            this.task(ctx, key, "task_card", step.input),
          ),
          value = CardSchema.parse(r.content);
        if (
          new Set(value.blocks.map((b) => b.kind)).size !== 3 ||
          value.material_ids.some((id) => !w.sources.some((s) => s.id === id))
        )
          throw new ApiError("MODEL_INVALID_RESULT", 422);
        return r;
      },
      async (r) => {
        const card = CardSchema.parse(r.content),
          value = {
            ...card,
            blocks: ["deep", "supplement", "reflection"].map((k) =>
              card.blocks.find((b) => b.kind === k)!,
            ),
            date: localDate,
            time_setting: null,
            review_ids: reviews.map((r) => String(r.id)),
          },
          prepared = await artifactWrite(
            this.repo,
            ctx.project_id,
            "task_card",
            value,
          );
        ref = prepared.ref;
        return {
          entities: [
            prepared.entity,
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: "planner",
                body: JSON.stringify(value),
                run_id: ctx.run_id,
              },
            },
          ],
          run_changes: { run_id: ctx.run_id, status: "waiting_user" },
          project_changes: { pending_input_json: null },
          events: [
            {
              type: "artifact_committed",
              role: "planner",
              run_id: ctx.run_id,
              payload: { entity_id: ref.id, text: "今日任务卡" },
            },
          ],
          result: { id: ref.id, version: ref.version },
        };
      },
    );
    return (
      ref ?? {
        project_id: ctx.project_id,
        id: String(receipt.result.id),
        kind: "task_card",
        version: Number(receipt.result.version),
      }
    );
  }
}
