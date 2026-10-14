import { z } from "zod";
import { ProjectRepository } from "../../db/repository";
import type { ToolContext } from "../../runtime/tool-context";
import type { RoleExecutor } from "./service";
import type { StepWriteSet, ArtifactRef, EntityWrite } from "../../db/types";
import { TaskRunner } from "../../runtime/runner";
import { authorizeTool } from "../../domain/permissions";
import { ApiError } from "../../http/errors";
import {
  evaluateGoalImpact,
  type ExplicitConstraint,
} from "../../domain/goal-impact";
import { artifactWrite } from "../artifacts";
const line = z.string().min(1).max(1000),
  plan = z
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
      time_setting: z.null(),
      time_constraint_text: z.string(),
    })
    .strict();
const AdjustmentSchema = z
  .object({
    plan,
    changed_constraints: z
      .array(
        z.object({ kind: z.enum(["goal", "time"]), raw_text: line }).strict(),
      )
      .max(2),
    estimated_finish: z.iso.date().nullable(),
    estimate_basis: z.string().max(2000),
    potentially_delays: z.boolean(),
    summary: line,
  })
  .strict();
export interface DecideProposal {
  proposal_id: string;
  proposal_version: number;
  decision: "accept" | "retain" | "pause";
}
export class AdjustmentService {
  constructor(
    private repo: ProjectRepository,
    private execute: RoleExecutor,
  ) {}
  async proposeAdjustment(ctx: ToolContext, feedbackId: string) {
    authorizeTool(ctx, { type: "propose_plan" });
    const w = await this.repo.readWorkspace(ctx.project_id),
      active = w.artifacts.find((a) => a.id === w.project.active_plan_id),
      feedback = w.evaluations.find((e) => e.id === feedbackId);
    if (!active || !feedback || !feedback.reveal_allowed)
      throw new ApiError("INVALID_STAGE", 409);
    const handoff = await this.repo.db
      .prepare(
        "SELECT seq FROM domain_events WHERE project_id=? AND type='handoff_committed' AND json_extract(payload_json,'$.entity_id')=? AND json_extract(payload_json,'$.to')='supervisor' LIMIT 1",
      )
      .bind(ctx.project_id, feedbackId)
      .first();
    if (!handoff) throw new ApiError("FORBIDDEN", 403);
    const old = JSON.parse(active.content),
      constraints: ExplicitConstraint[] = [
        { kind: "scope", raw_text: w.project.goal_text },
        { kind: "time", raw_text: w.project.time_constraint_text },
      ];
    if (/^\d{4}-\d{2}-\d{2}$/.test(w.project.time_constraint_text))
      constraints.push({
        kind: "deadline",
        raw_text: w.project.time_constraint_text,
        value: w.project.time_constraint_text,
      });
    const key = `adjust:${feedbackId}`;
    const receipt = await new TaskRunner(this.repo).executeStep(
      ctx,
      ctx.run_id,
      {
        key,
        role: "planner",
        action: { type: "propose_plan" },
        input: {
          active_plan: old,
          constraints,
          feedback: {
            id: feedbackId,
            verdict: feedback.verdict,
            gap: feedback.gap,
          },
          output_contract: {
            plan: old,
            changed_constraints: [
              {
                kind: "goal | time",
                raw_text: "Only explicitly proposed changes shown to user",
              },
            ],
            estimated_finish: "YYYY-MM-DD or null",
            estimate_basis:
              "evidence-based estimate, no arbitrary score/day threshold",
            potentially_delays: "boolean",
            summary: "concrete changes and tradeoff",
          },
        },
      },
      async (step) => {
        const r = await this.execute({
          project_id: ctx.project_id,
          run_id: ctx.run_id,
          epoch: ctx.epoch,
          step_key: key,
          role: "planner",
          action: "adjustment",
          evidence_ids: [feedbackId, String(handoff.seq)],
          public_context: step.input,
        });
        const d = AdjustmentSchema.parse(r.content);
        const oldPromises=JSON.stringify(old.tasks.map((t:any)=>[t.goal,t.skill_id,t.output]).sort());
        const newPromises=JSON.stringify(d.plan.tasks.map(t=>[t.goal,t.skill_id,t.output]).sort());
        if(oldPromises!==newPromises&&!d.changed_constraints.some(c=>c.kind==='goal'))throw new ApiError('MODEL_INVALID_RESULT',422);
        if(d.plan.time_constraint_text!==w.project.time_constraint_text&&!d.changed_constraints.some(c=>c.kind==='time'))throw new ApiError('MODEL_INVALID_RESULT',422);
        if (
          d.plan.tasks.some((t) =>
            t.material_ids.some((id) => !w.sources.some((s) => s.id === id)),
          ) ||
          new Set(d.changed_constraints.map((c) => c.kind)).size !==
            d.changed_constraints.length
        )
          throw new ApiError("MODEL_INVALID_RESULT", 422);
        return r;
      },
      async (r): Promise<StepWriteSet> => {
        const d = AdjustmentSchema.parse(r.content),
          sameScope =
            JSON.stringify(
              [...old.tasks]
                .map((t: any) => [t.goal, t.skill_id, t.output])
                .sort(),
            ) ===
            JSON.stringify(
              d.plan.tasks.map((t) => [t.goal, t.skill_id, t.output]).sort(),
            ),
          impact = evaluateGoalImpact(constraints, {
            ...d,
            scope_changed:
              !sameScope ||
              d.changed_constraints.some((c) => c.kind === "goal"),
            time_commitment_changed:
              d.changed_constraints.some((c) => c.kind === "time") ||
              d.plan.time_constraint_text !== w.project.time_constraint_text,
            reorder_only: sameScope,
          });
        const id = crypto.randomUUID(),
          version = Number(w.proposals.at(-1)?.version ?? 0) + 1,
          changes = {
            ...d,
            comparisons: impact.comparisons,
            uncertainty: impact.uncertainty,
            feedback_id: feedbackId,
          };
        // Never let a model change the saved time constraint through plan content.
        changes.plan.time_constraint_text = w.project.time_constraint_text;
        const summary = `${d.summary}\n${impact.comparisons.join("\n")}\n${impact.uncertainty}\n拟变更约束：${d.changed_constraints.map((c) => `${c.kind === "goal" ? "目标" : "时间"} → ${c.raw_text}`).join("；") || "无"}\n预估完成：${d.estimated_finish ?? "不确定"}；依据：${d.estimate_basis || "暂无"}`;
        const entities: EntityWrite[] = [
          {
            table: "plan_proposals",
            row: {
              id,
              version,
              base_plan_version: active.version,
              base_goal_version: w.project.goal_version,
              changes_json: JSON.stringify(changes),
              impact: impact.impact,
              summary,
              status: impact.impact === "none" ? "activated" : "pending",
            },
          },
        ];
        let planRef: ArtifactRef | undefined;
        if (impact.impact === "none") {
          const a = await artifactWrite(
            this.repo,
            ctx.project_id,
            "plan",
            changes.plan,
          );
          planRef = a.ref;
          entities.push(a.entity);
        }
        return {
          entities,
          project_changes: planRef
            ? { active_plan_id: planRef.id }
            : {
                pending_input_json: JSON.stringify({
                  kind: "decision",
                  entity_id: id,
                  version,
                  expected_role: "supervisor",
                }),
              },
          run_changes: {
            run_id: ctx.run_id,
            status: planRef ? "waiting_user" : "waiting_decision",
          },
          events: [
            {
              type: planRef ? "plan_activated" : "decision_required",
              role: "planner",
              run_id: ctx.run_id,
              payload: { entity_id: id, text: summary },
            },
            {
              type: "handoff_committed",
              role: "supervisor",
              run_id: ctx.run_id,
              payload: {
                from: "supervisor",
                to: "planner",
                entity_id: feedbackId,
                text: "依据已完成的答题反馈调整",
              },
            },
          ],
          result: { id, version },
        };
      },
    );
    return {
      id: String(receipt.result.id),
      version: Number(receipt.result.version),
    };
  }
  async recordDecision(ctx: ToolContext, input: DecideProposal) {
    authorizeTool(ctx, { type: "activate_plan" });
    const key = `decision:${input.proposal_id}:${input.proposal_version}`,
      prior = await this.repo.readReceipt(
        ctx.project_id,
        ctx.operation_id,
        key,
      );
    if (prior) return;
    const w = await this.repo.readWorkspace(ctx.project_id),
      p = w.proposals.find((p) => p.id === input.proposal_id),
      active = w.artifacts.find((a) => a.id === w.project.active_plan_id),
      message = w.messages.find(
        (m) => m.run_id === ctx.run_id && m.sender_role === "user",
      );
    if (
      !p ||
      !active ||
      !message ||
      Number(p.version) !== input.proposal_version ||
      Number(p.base_plan_version) !== active.version ||
      Number(p.base_goal_version) !== w.project.goal_version ||
      !["pending", "paused"].includes(String(p.status))
    )
      throw new ApiError("REVISION_CONFLICT", 409);
    const actual = JSON.parse(
      w.runs.find((r) => r.id === ctx.run_id)?.command_json ?? "null",
    );
    if (
      actual?.type !== "decide_proposal" ||
      actual.proposal_id !== input.proposal_id ||
      actual.proposal_version !== input.proposal_version ||
      actual.decision !== input.decision
    )
      throw new ApiError("FORBIDDEN", 403);
    const d = AdjustmentSchema.strip().parse(
        JSON.parse(String(p.changes_json)),
      ),
      id = crypto.randomUUID(),
      entities: EntityWrite[] = [
        {
          table: "decisions",
          row: {
            id,
            proposal_id: input.proposal_id,
            proposal_version: input.proposal_version,
            decision: input.decision,
            message_id: message.id,
          },
        },
      ];
    let changes: StepWriteSet["project_changes"] = { pending_input_json: null };
    if (input.decision !== "pause") {
      let value = d.plan;
      if (input.decision === "retain") {
        const old = JSON.parse(active.content);
        value = {
          ...old,
          tasks: [...old.tasks].sort(
            (a: any, b: any) =>
              d.plan.tasks.findIndex((t) => t.goal === a.goal) -
              d.plan.tasks.findIndex((t) => t.goal === b.goal),
          ),
        };
      }
      if (input.decision === "accept" && d.changed_constraints.length) {
        const goal =
            d.changed_constraints.find((c) => c.kind === "goal")?.raw_text ??
            w.project.goal_text,
          time =
            d.changed_constraints.find((c) => c.kind === "time")?.raw_text ??
            w.project.time_constraint_text;
        changes = {
          ...changes,
          goal_version: w.project.goal_version + 1,
          goal_text: goal,
          time_constraint_text: time,
          completion_json: JSON.stringify({
            status: "stale",
            correct_count: null,
            total_count: null,
            policy_version: null,
            goal_version: w.project.goal_version + 1,
            items: [],
          }),
          phase: d.changed_constraints.some((c) => c.kind === "goal")
            ? "scoping"
            : "learning",
        };
        value = { ...value, time_constraint_text: time };
        for (const c of d.changed_constraints)
          entities.push({
            table: "project_constraints",
            row: {
              id: crypto.randomUUID(),
              goal_version: w.project.goal_version + 1,
              kind: c.kind,
              raw_text: c.raw_text,
              value_json: JSON.stringify({
                prior:
                  c.kind === "goal"
                    ? w.project.goal_text
                    : w.project.time_constraint_text,
              }),
            },
          });
      }
      const a = await artifactWrite(this.repo, ctx.project_id, "plan", value, [
        message.id,
      ]);
      entities.push(a.entity);
      changes.active_plan_id = a.ref.id;
    } else
      changes.pending_input_json = JSON.stringify({
        kind: "decision",
        entity_id: p.id,
        version: p.version,
        expected_role: "supervisor",
      });
    const current = await this.repo.getProject(ctx.owner_id, ctx.project_id);
    await this.repo.commitStep(
      {
        ...ctx,
        actor: "planner",
        step_key: key,
        base_revision: current.revision,
      },
      {
        entities,
        project_changes: changes,
        proposal_changes: {
          id: input.proposal_id,
          status:
            input.decision === "pause"
              ? "paused"
              : input.decision === "retain"
                ? "retained"
                : "activated",
        },
        run_changes: {
          run_id: ctx.run_id,
          status:
            input.decision === "pause" ? "waiting_decision" : "waiting_user",
        },
        events: [
          {
            type:
              input.decision === "pause"
                ? "role_status_changed"
                : "plan_activated",
            role: "supervisor",
            payload: {
              entity_id: input.proposal_id,
              text:
                input.decision === "pause"
                  ? "已暂缓决定，原计划保留"
                  : input.decision === "retain"
                    ? "保留原目标，按现有任务重排"
                    : "已按显示的约束变更更新计划",
            },
          },
        ],
        result: { id },
      },
    );
  }
}
