import { parseMention } from "@learning/contracts";
import { runLearningCommand } from "../features/workflow";
import { Agent } from "agents";
import type { CommandEnvelope, Role } from "@learning/contracts";
import { z } from "zod";
import type { Env } from "../env";
import type { Principal } from "../http/auth";
import { ProjectRepository } from "../db/repository";
import type { RunRecord } from "../db/types";
import { TaskRunner } from "../runtime/runner";
import type {
  RuntimeState,
  RoleTask,
  RoleResult,
  WorkStep,
} from "../runtime/types";
import { transition } from "../domain/state-machine";
import { ApiError } from "../http/errors";
import { ConfiguredModelGateway } from "../providers/model";
import { ROLE_PROMPTS } from "./prompts";
import { PlannerAgent } from "./planner";
import { CuratorAgent } from "./curator";
import { CoachAgent } from "./coach";
export class ProjectSupervisor extends Agent<Env, RuntimeState> {
  initialState: RuntimeState = {
    owner_id: null,
    project_id: null,
    run_id: null,
    step_key: null,
    epoch: 0,
    error_code: null,
  };
  private inFlight = new Set<string>();
  async bindProject(principal: Principal, projectId: string) {
    await new ProjectRepository(this.env.DB).getProject(
      principal.owner_id,
      projectId,
    );
    if (
      this.state.project_id &&
      (this.state.project_id !== projectId ||
        this.state.owner_id !== principal.owner_id)
    )
      throw new ApiError("FORBIDDEN", 403);
    if (!this.state.project_id)
      this.setState({
        ...this.state,
        owner_id: principal.owner_id,
        project_id: projectId,
      });
  }
  private context() {
    if (!this.state.owner_id || !this.state.project_id)
      throw new ApiError("FORBIDDEN", 403);
    return { owner_id: this.state.owner_id, project_id: this.state.project_id };
  }
  async accept(principal: Principal, input: CommandEnvelope) {
    const ctx = this.context();
    if (principal.owner_id !== ctx.owner_id)
      throw new ApiError("FORBIDDEN", 403);
    const repo = new ProjectRepository(this.env.DB),
      p = await repo.getProject(ctx.owner_id, ctx.project_id);
    const existing = await repo.db
      .prepare(
        "SELECT client_operation_id FROM command_receipts WHERE project_id=? AND client_operation_id=?",
      )
      .bind(ctx.project_id, input.client_operation_id)
      .first();
    if (existing) {
      const accepted = await repo.acceptCommand(ctx, input);
      await this.reconcile();
      return accepted;
    }
    if (input.command.type === "send_message") {
      const mention = parseMention(
        input.command.text,
        input.command.target_role,
      );
      if (!mention.ok) throw new ApiError("AMBIGUOUS_MENTION", 422);
    }
    const pending = p.pending_input_json
      ? JSON.parse(p.pending_input_json)
      : null;
    const gate = transition(
      { phase: p.phase, pending_kind: pending?.kind ?? null },
      input.command,
    );
    if (!gate.allowed) throw new ApiError(gate.code ?? "INVALID_STAGE", 409);
    if (
      ["pause_run", "cancel_run", "resume_run", "retry_run"].includes(
        input.command.type,
      ) &&
      "run_id" in input.command
    ) {
      const controlId = input.command.run_id;
      const target = (await repo.readWorkspace(ctx.project_id)).runs.find(
        (r) => r.id === controlId,
      );
      if (!target || target.id !== p.active_run_id)
        throw new ApiError("FORBIDDEN", 403);
      if (
        (input.command.type === "resume_run" && target.status !== "paused") ||
        (input.command.type === "retry_run" && target.status !== "failed")
      )
        throw new ApiError("INVALID_STAGE", 409);
    }
    const accepted = await repo.acceptCommand(ctx, input),
      runner = new TaskRunner(repo);
    const cmd = input.command;
    if (
      ["pause_run", "cancel_run", "resume_run", "retry_run"].includes(
        cmd.type,
      ) &&
      "run_id" in cmd
    ) {
      const action =
        cmd.type === "pause_run"
          ? "pause"
          : cmd.type === "cancel_run"
            ? "cancel"
            : cmd.type === "resume_run"
              ? "resume"
              : "retry";
      await runner.control(ctx, cmd.run_id, action);
      await this.finishControl(accepted.run_id);
      if (action === "pause" || action === "cancel") {
        for (const Cls of [PlannerAgent, CuratorAgent, CoachAgent])
          this.dynamicAgents.abort(Cls, Cls.name, new Error("paused"));
      } else {
        const current = await repo.getProject(ctx.owner_id, ctx.project_id);
        await this.schedule(
          0,
          "advanceRun",
          { run_id: cmd.run_id, epoch: current.run_epoch },
          { idempotent: true },
        );
      }
      return accepted;
    }
    if (cmd.type === "supplement_requirements") {
      if (p.active_run_id) await runner.control(ctx, p.active_run_id, "cancel");
      const latest = await repo.getProject(ctx.owner_id, ctx.project_id);
      await repo.commitStep(
        {
          ...ctx,
          operation_id: input.client_operation_id,
          step_key: "supplement_generation",
          base_revision: latest.revision,
          epoch: latest.run_epoch,
          actor: "runtime",
        },
        {
          project_changes: {
            active_run_id: accepted.run_id,
            pending_input_json: null,
          },
          run_changes: {
            run_id: accepted.run_id,
            status: "queued",
            epoch: latest.run_epoch,
          },
          events: [
            {
              type: "handoff_committed",
              role: "supervisor",
              run_id: accepted.run_id,
              payload: {
                from: "supervisor",
                to: "planner",
                text: "已保存补充要求并停止旧任务，重新协调后续安排",
              },
            },
          ],
        },
      );
      for (const Cls of [PlannerAgent, CuratorAgent, CoachAgent])
        this.dynamicAgents.abort(
          Cls,
          Cls.name,
          new Error("requirements changed"),
        );
    }
    const current = await repo.getProject(ctx.owner_id, ctx.project_id);
    this.setState({
      ...this.state,
      run_id: accepted.run_id,
      epoch: current.run_epoch,
      error_code: null,
    });
    await this.schedule(
      0,
      "advanceRun",
      { run_id: accepted.run_id, epoch: current.run_epoch },
      { idempotent: true },
    );
    return accepted;
  }
  private async finishControl(runId: string) {
    const repo = new ProjectRepository(this.env.DB),
      ctx = this.context(),
      w = await repo.readWorkspace(ctx.project_id),
      run = w.runs.find((r) => r.id === runId);
    if (!run) return;
    await repo.commitStep(
      {
        ...ctx,
        operation_id: run.operation_id,
        step_key: "control_complete",
        base_revision: w.project.revision,
        epoch: w.project.run_epoch,
        actor: "runtime",
      },
      { run_changes: { run_id: runId, status: "succeeded" } },
    );
  }
  async onStart() {
    if (this.state.project_id) await this.reconcile();
  }
  async reconcile() {
    if (!this.state.project_id) return;
    const repo = new ProjectRepository(this.env.DB),
      ctx = this.context(),
      w = await repo.readWorkspace(ctx.project_id);
    for (const run of w.runs.filter(
      (r) =>
        ["queued", "running"].includes(r.status) &&
        r.epoch === w.project.run_epoch,
    ))
      await this.schedule(
        0,
        "advanceRun",
        { run_id: run.id, epoch: run.epoch },
        { idempotent: true },
      );
  }
  async advanceRun(payload: { run_id: string; epoch: number }) {
    if (this.inFlight.has(payload.run_id)) return;
    this.inFlight.add(payload.run_id);
    let recoveryId: string | undefined;
    const repo = new ProjectRepository(this.env.DB),
      ctx = this.context();
    try {
      const w = await repo.readWorkspace(ctx.project_id),
        run = w.runs.find((r) => r.id === payload.run_id);
      if (
        !run ||
        run.epoch !== payload.epoch ||
        run.epoch !== w.project.run_epoch ||
        !["queued", "running"].includes(run.status)
      )
        return;
      recoveryId = (
        await this.schedule(60, "recoverRun", payload, { idempotent: true })
      ).id;
      this.setState({ ...this.state, run_id: run.id, epoch: run.epoch });
      await this.executeCommand(run);
      const finished = await repo.readWorkspace(ctx.project_id),
        currentRun = finished.runs.find((r) => r.id === run.id);
      if (
        currentRun &&
        ["queued", "running"].includes(currentRun.status) &&
        finished.project.run_epoch === run.epoch
      )
        await repo.commitStep(
          {
            ...ctx,
            operation_id: run.operation_id,
            step_key: `run_finish:${run.epoch}`,
            base_revision: finished.project.revision,
            epoch: run.epoch,
            actor: "runtime",
          },
          { run_changes: { run_id: run.id, status: "waiting_user" } },
        );
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String(error.code)
          : "STORAGE_UNAVAILABLE";
      this.setState({ ...this.state, error_code: code });
      try {
        const w = await repo.readWorkspace(ctx.project_id),
          run = w.runs.find((r) => r.id === payload.run_id);
        if (
          run &&
          run.epoch === payload.epoch &&
          ["queued", "running"].includes(run.status)
        )
          await new TaskRunner(repo).fail(ctx, run, error);
      } catch {}
    } finally {
      if (recoveryId) {
        try {
          const latest = await repo.readWorkspace(ctx.project_id),
            active = latest.runs.find((r) => r.id === payload.run_id);
          if (
            !active ||
            !["queued", "running"].includes(active.status) ||
            active.epoch !== latest.project.run_epoch
          )
            await this.cancelSchedule(recoveryId);
        } catch {
          /* Keep the durable recovery callback while storage is unavailable. */
        }
      }
      this.inFlight.delete(payload.run_id);
    }
  }
  async recoverRun(payload: { run_id: string; epoch: number }) {
    await this.advanceRun(payload);
  }
  async executeTask(task: RoleTask): Promise<RoleResult> {
    if (task.project_id !== this.context().project_id)
      throw new ApiError("FORBIDDEN", 403);
    if (task.role === "supervisor")
      return new ConfiguredModelGateway(this.env).generate({
        task,
        system: ROLE_PROMPTS.supervisor,
        schema_name: task.action,
      });
    const Cls =
      task.role === "planner"
        ? PlannerAgent
        : task.role === "curator"
          ? CuratorAgent
          : CoachAgent;
    const expert = await this.dynamicAgents.get(Cls, Cls.name);
    return expert.execute(task);
  }
  private async executeCommand(run: RunRecord): Promise<void> {
    const ctx = this.context(),
      repo = new ProjectRepository(this.env.DB),
      w = await repo.readWorkspace(ctx.project_id),
      cmd = JSON.parse(run.command_json) as CommandEnvelope["command"];
    if (cmd.type === "request_stage_jump") {
      await repo.commitStep(
        {
          ...ctx,
          operation_id: run.operation_id,
          step_key: "stage_jump",
          base_revision: w.project.revision,
          epoch: run.epoch,
          actor: "runtime",
        },
        {
          project_changes: { phase: cmd.phase, pending_input_json: null },
          run_changes: { run_id: run.id, status: "succeeded" },
          entities: [
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: "supervisor",
                body: "已按你的要求跳转阶段；跳过的测验与学习不记为已完成。",
              },
            },
          ],
          events: [
            {
              type: "message_committed",
              role: "supervisor",
              run_id: run.id,
              payload: { text: "按用户要求跳过阶段，不生成掌握证据" },
            },
          ],
        },
      );
      return;
    }
    if (cmd.type === "supplement_requirements") {
      return this.executeCommand({
        ...run,
        command_json: JSON.stringify({
          type: "send_message",
          mode: "message",
          target_role: "planner",
          text: cmd.text,
        }),
      });
    }
    if (cmd.type === "send_message") {
      const mention = parseMention(cmd.text, cmd.target_role);
      if (!mention.ok) throw new ApiError("AMBIGUOUS_MENTION", 422);
      if (mention.role) cmd.target_role = mention.role;
    }
    if (
      await runLearningCommand(
        repo,
        ctx,
        run,
        (task) => this.executeTask(task),
        cmd,
        this.env,
      )
    )
      return;
    if (cmd.type !== "send_message") throw new ApiError("NOT_IMPLEMENTED", 501);
    let role: Role = cmd.target_role ?? "supervisor";
    const runner = new TaskRunner(repo);
    if (role === "supervisor") {
      const routing = await runner.executeStep(
        ctx,
        run.id,
        {
          key: "route",
          role: "supervisor",
          action: { type: "route" },
          input: { text: cmd.text, phase: w.project.phase },
        },
        (step) =>
          this.executeTask({
            project_id: ctx.project_id,
            run_id: run.id,
            epoch: run.epoch,
            step_key: step.key,
            role: step.role,
            action: "route",
            evidence_ids: [],
            public_context: step.input,
          }),
        (result) => {
          const next = z
            .enum(["planner", "curator", "coach"])
            .parse(result.content.role);
          return {
            result: { role: next },
            events: [
              {
                type: "handoff_committed",
                role: "supervisor",
                run_id: run.id,
                payload: {
                  from: "supervisor",
                  to: next,
                  text: "按当前学习问题派活",
                },
              },
            ],
          };
        },
      );
      role = routing.result.role as Role;
    }
    const action =
      role === "planner"
        ? { type: "write_artifact" as const, kind: "definition" as const }
        : role === "curator"
          ? { type: "write_artifact" as const, kind: "learning_card" as const }
          : { type: "present_question" as const };
    await runner.executeStep(
      ctx,
      run.id,
      {
        key: "reply",
        role,
        action,
        input: { text: cmd.text, phase: w.project.phase },
      },
      (step) =>
        this.executeTask({
          project_id: ctx.project_id,
          run_id: run.id,
          epoch: run.epoch,
          step_key: step.key,
          role: step.role,
          action: "message",
          evidence_ids: [],
          public_context: step.input,
        }),
      (result) => {
        const text = z.string().min(1).max(12000).parse(result.content.text);
        return {
          entities: [
            {
              table: "messages",
              row: {
                id: crypto.randomUUID(),
                sender_role: role,
                body: text,
                run_id: run.id,
              },
            },
          ],
          run_changes: { run_id: run.id, status: "waiting_user" },
          events: [
            {
              type: "message_committed",
              role,
              run_id: run.id,
              payload: { text },
            },
          ],
        };
      },
    );
  }
}
