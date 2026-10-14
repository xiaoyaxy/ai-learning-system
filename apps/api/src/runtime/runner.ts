import {
  ProjectRepository,
  RepositoryError,
  payloadHash,
} from "../db/repository";
import type {
  IngressContext,
  StepWriteSet,
  StepContext,
  RunRecord,
  RowValue,
} from "../db/types";
import { authorizeTool } from "../domain/permissions";
import { makeToolContext } from "./tool-context";
import { BudgetTracker, type RunBudget } from "./budget";
import { RoleResultSchema, type RoleResult, type WorkStep } from "./types";
import { ApiError } from "../http/errors";
export class TaskRunner {
  private inFlight = new Set<string>();
  constructor(private repo: ProjectRepository) {}
  async executeStep(
    ctx: IngressContext,
    runId: string,
    step: WorkStep,
    call: (task: WorkStep) => Promise<RoleResult>,
    apply: (
      result: RoleResult,
      context: StepContext,
    ) => StepWriteSet | Promise<StepWriteSet>,
  ) {
    const lock = runId + ":" + step.key;
    if (this.inFlight.has(lock)) throw new ApiError("RUN_BUSY", 409);
    this.inFlight.add(lock);
    try {
      return await this.executeUnlocked(ctx, runId, step, call, apply);
    } finally {
      this.inFlight.delete(lock);
    }
  }
  private async executeUnlocked(
    ctx: IngressContext,
    runId: string,
    step: WorkStep,
    call: (task: WorkStep) => Promise<RoleResult>,
    apply: (
      result: RoleResult,
      context: StepContext,
    ) => StepWriteSet | Promise<StepWriteSet>,
  ) {
    const w = await this.repo.readWorkspace(ctx.project_id);
    await this.repo.getProject(ctx.owner_id, ctx.project_id);
    const run = w.runs.find((r) => r.id === runId);
    if (!run) throw new ApiError("FORBIDDEN", 403);
    const prior = await this.repo.readReceipt(
      ctx.project_id,
      run.operation_id,
      step.key,
    );
    if (prior) return prior;
    if (
      run.epoch !== w.project.run_epoch ||
      ["paused", "cancelled"].includes(run.status)
    )
      throw new RepositoryError("STALE_EPOCH");
    const context = {
      ...ctx,
      operation_id: run.operation_id,
      step_key: step.key,
      base_revision: w.project.revision,
      epoch: run.epoch,
      actor: step.role,
      run_id: runId,
    };
    authorizeTool(makeToolContext(context), step.action);
    const callId = `${runId}:${step.key}:${run.retry_count}`,
      reservedKey = `reserve:${step.key}:${run.retry_count}`,
      cached = await this.repo.db
        .prepare("SELECT * FROM provider_calls WHERE project_id=? AND id=?")
        .bind(ctx.project_id, callId)
        .first<{ status: string; result_json: string | null }>();
    const requestHash = await payloadHash(step);
    const successful = await this.repo.db
      .prepare(
        "SELECT status,result_json FROM provider_calls WHERE project_id=? AND run_id=? AND request_hash=? AND status='succeeded' ORDER BY rowid DESC LIMIT 1",
      )
      .bind(ctx.project_id, runId, requestHash)
      .first<{ status: string; result_json: string | null }>();
    const reusable = successful ?? cached;
    let result: RoleResult;
    try {
      if (reusable?.status === "succeeded" && reusable.result_json) {
        result = RoleResultSchema.parse(JSON.parse(reusable.result_json));
      } else {
        if (cached?.status === "started")
          throw new ApiError("OUTCOME_UNKNOWN", 409, true);
        const budget = new BudgetTracker(
          JSON.parse(run.budget_json) as RunBudget,
        );
        if (step.external_kind !== "tool") budget.consume("model");
        budget.consume("tool");
        if (step.external_kind !== "tool") budget.consume("handoff");
        const p = await this.repo.getProject(ctx.owner_id, ctx.project_id);
        await this.repo.commitStep(
          {
            ...context,
            actor: "runtime",
            step_key: reservedKey,
            base_revision: p.revision,
          },
          {
            entities: [
              {
                table: "provider_calls",
                row: {
                  id: callId,
                  run_id: runId,
                  request_hash: await payloadHash(step),
                  status: "started",
                },
              },
            ],
            events: [
              {
                type: "task_assigned",
                role: "supervisor",
                run_id: runId,
                payload: { to: step.role, text: step.action.type },
              },
            ],
            run_changes: {
              run_id: runId,
              status: "running",
              budget_json: JSON.stringify(budget.snapshot()),
            },
          },
        );
        result = RoleResultSchema.parse(await call(step));
        const current = await this.repo.getProject(
          ctx.owner_id,
          ctx.project_id,
        );
        await this.repo.commitStep(
          {
            ...context,
            actor: "runtime",
            step_key: `cache:${step.key}:${run.retry_count}`,
            base_revision: current.revision,
          },
          {
            provider_changes: {
              id: callId,
              status: "succeeded",
              result_json: JSON.stringify(result),
              usage_json: result.usage ? JSON.stringify(result.usage) : null,
            },
          },
        );
      }
      const current = await this.repo.getProject(ctx.owner_id, ctx.project_id);
      if (current.run_epoch !== run.epoch)
        throw new RepositoryError("STALE_EPOCH");
      const commitCtx = { ...context, base_revision: current.revision };
      const writes = await apply(result, commitCtx);
      return await this.repo.commitStep(commitCtx, {
        ...writes,
        entities: [
          ...(writes.entities ?? []),
          {
            table: "run_steps",
            row: {
              id: crypto.randomUUID(),
              run_id: runId,
              step_key: step.key,
              status: "committed",
              result_json: JSON.stringify(writes.result ?? {}),
            },
          },
        ],
        run_changes: {
          run_id: runId,
          status: "running",
          retry_count: 0,
          ...writes.run_changes,
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["STALE_EPOCH", "REVISION_CONFLICT"].includes(String(error.code))
      )
        throw error;
      await this.fail(ctx, run, error);
      throw error;
    }
  }
  async fail(ctx: IngressContext, run: RunRecord, error: unknown) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : String(error).includes("D1_ERROR")
          ? "STORAGE_UNAVAILABLE"
          : "MODEL_INVALID_RESULT";
    try {
      const p = await this.repo.getProject(ctx.owner_id, ctx.project_id);
      if (p.run_epoch !== run.epoch) return;
      await this.repo.commitStep(
        {
          ...ctx,
          operation_id: run.operation_id,
          step_key: `failure:${run.id}:${run.retry_count}:${p.revision}`,
          base_revision: p.revision,
          epoch: run.epoch,
          actor: "runtime",
        },
        {
          run_changes: { run_id: run.id, status: "failed", error_code: code },
          events: [
            {
              type: "run_failed",
              run_id: run.id,
              role: "supervisor",
              payload: {
                status: code,
                text:
                  code === "OUTCOME_UNKNOWN"
                    ? "上次调用结果不明确，重试可能再次产生用量"
                    : "当前步骤未完成，已有进度保留",
              },
            },
          ],
        },
      );
    } catch {
      /* Storage may be unavailable; the owning Agent retains its checkpoint. */
    }
  }
  async control(
    ctx: IngressContext,
    runId: string,
    action: "pause" | "cancel" | "resume" | "retry",
  ) {
    const p = await this.repo.getProject(ctx.owner_id, ctx.project_id),
      w = await this.repo.readWorkspace(ctx.project_id),
      run = w.runs.find((r) => r.id === runId);
    if (!run) throw new ApiError("FORBIDDEN", 403);
    if (
      (action === "resume" && run.status !== "paused") ||
      (action === "retry" && run.status !== "failed")
    )
      throw new ApiError("INVALID_STAGE", 409);
    if (action === "retry" && run.retry_count >= 2)
      throw new ApiError("BUDGET_EXCEEDED", 409);
    const status =
      action === "pause"
        ? "paused"
        : action === "cancel"
          ? "cancelled"
          : "queued";
    if (run.status === status && ["pause", "cancel"].includes(action)) return;
    const epoch = p.run_epoch + 1;
    await this.repo.commitStep(
      {
        ...ctx,
        operation_id: run.operation_id,
        step_key: `control:${action}:${p.revision}`,
        base_revision: p.revision,
        epoch: p.run_epoch,
        actor: "runtime",
      },
      {
        project_changes: { run_epoch: epoch, active_run_id: runId },
        run_changes: {
          run_id: runId,
          status,
          epoch,
          retry_count:
            action === "retry" ? run.retry_count + 1 : run.retry_count,
          error_code: null,
        },
        events: [
          {
            type: "role_status_changed",
            run_id: runId,
            role: "supervisor",
            payload: {
              status,
              text:
                action === "pause"
                  ? "协作已暂停，已提交内容保留"
                  : action === "cancel"
                    ? "协作已取消"
                    : "从检查点继续",
            },
          },
        ],
      },
    );
  }
}
