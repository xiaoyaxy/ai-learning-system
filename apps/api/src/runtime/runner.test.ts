import { runInDurableObject } from "cloudflare:test";
import type { ProjectSupervisor } from "../agents/project-supervisor";
import { beforeAll, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { ProjectRepository } from "../db/repository";
import migration from "../db/migrations/0001_initial.sql?raw";
import { TaskRunner } from "./runner";
import { BudgetTracker } from "./budget";
import { transition } from "../domain/state-machine";
import type { RoleResult } from "./types";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
});
async function fixture() {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID(),
    p = await repo.create(owner, {
      client_operation_id: crypto.randomUUID(),
      name: "Agent",
      goal_text: "理解 Agent",
      time_constraint_text: "两周",
      timezone: "Asia/Shanghai",
    }),
    command = {
      client_operation_id: crypto.randomUUID(),
      expected_revision: 0,
      command: {
        type: "send_message" as const,
        text: "开始",
        mode: "message" as const,
      },
    },
    accepted = await repo.acceptCommand(
      { owner_id: owner, project_id: p.id },
      command,
    );
  return {
    repo,
    owner,
    p,
    accepted,
    runner: new TaskRunner(repo),
    step: {
      key: "reply",
      role: "planner" as const,
      action: { type: "write_artifact" as const, kind: "definition" as const },
      input: { text: "开始" },
    },
  };
}
const result: RoleResult = {
  kind: "message",
  content: { text: "先确认本次学习目标" },
  evidence_ids: [],
  usage: null,
};
describe("bounded recoverable steps", () => {
  it("rejects the ninth model call without resetting on retries", () => {
    const budget = new BudgetTracker();
    for (let i = 0; i < 8; i++) budget.consume("model");
    expect(() => budget.consume("model")).toThrow("BUDGET_EXCEEDED");
  });
  it("waits for an answer rather than letting curator reveal it", () => {
    expect(
      transition(
        { phase: "practicing", pending_kind: "answer" },
        {
          type: "send_message",
          mode: "message",
          target_role: "curator",
          text: "给我答案",
        },
      ),
    ).toMatchObject({ allowed: false, code: "ANSWER_PENDING" });
  });
  it("replays committed results without another external call", async () => {
    const { runner, repo, owner, p, accepted, step } = await fixture();
    let calls = 0;
    const execute = async () => {
      calls++;
      return result;
    };
    const apply = () => ({
      entities: [
        {
          table: "messages" as const,
          row: {
            id: crypto.randomUUID(),
            sender_role: "planner",
            body: "先确认本次学习目标",
          },
        },
      ],
    });
    await runner.executeStep(
      { owner_id: owner, project_id: p.id },
      accepted.run_id,
      step,
      execute,
      apply,
    );
    const restarted = new TaskRunner(repo);
    await restarted.executeStep(
      { owner_id: owner, project_id: p.id },
      accepted.run_id,
      step,
      execute,
      apply,
    );
    expect(calls).toBe(1);
    expect(
      (await repo.readWorkspace(p.id)).messages.filter(
        (m) => m.sender_role === "planner",
      ),
    ).toHaveLength(1);
  });
  it("fences a model result that returns after pause", async () => {
    const { runner, repo, owner, p, accepted, step } = await fixture();
    let resolve!: (value: RoleResult) => void, started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    const pending = runner.executeStep(
      { owner_id: owner, project_id: p.id },
      accepted.run_id,
      step,
      () => {
        started();
        return new Promise<RoleResult>((r) => (resolve = r));
      },
      () => ({
        entities: [
          {
            table: "messages",
            row: {
              id: crypto.randomUUID(),
              sender_role: "planner",
              body: "obsolete",
            },
          },
        ],
      }),
    );
    await ready;
    await runner.control(
      { owner_id: owner, project_id: p.id },
      accepted.run_id,
      "pause",
    );
    resolve(result);
    await expect(pending).rejects.toMatchObject({ code: "STALE_EPOCH" });
    expect(
      (await repo.readWorkspace(p.id)).messages.some(
        (m) => m.body === "obsolete",
      ),
    ).toBe(false);
    expect(
      (await repo.readWorkspace(p.id)).runs.find(
        (r) => r.id === accepted.run_id,
      )?.status,
    ).toBe("paused");
  });
  it("stops on quota errors and retains the original user message", async () => {
    const { runner, repo, owner, p, accepted, step } = await fixture();
    await expect(
      runner.executeStep(
        { owner_id: owner, project_id: p.id },
        accepted.run_id,
        step,
        async () => {
          throw Object.assign(new Error("quota"), { code: "QUOTA_EXCEEDED" });
        },
        () => ({}),
      ),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    const w = await repo.readWorkspace(p.id);
    expect(w.messages[0].body).toBe("开始");
    expect(w.runs.find((r) => r.id === accepted.run_id)?.error_code).toBe(
      "QUOTA_EXCEEDED",
    );
  });
  it("does not retry an external call with an unknown result", async () => {
    const { runner, repo, owner, p, accepted, step } = await fixture();
    await db
      .prepare(
        "INSERT INTO provider_calls(project_id,id,run_id,request_hash,status) VALUES(?,?,?,?,?)",
      )
      .bind(
        p.id,
        `${accepted.run_id}:reply:0`,
        accepted.run_id,
        "request",
        "started",
      )
      .run();
    let calls = 0;
    await expect(
      runner.executeStep(
        { owner_id: owner, project_id: p.id },
        accepted.run_id,
        step,
        async () => {
          calls++;
          return result;
        },
        () => ({}),
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(calls).toBe(0);
    expect(
      (await repo.readWorkspace(p.id)).runs.find(
        (r) => r.id === accepted.run_id,
      )?.error_code,
    ).toBe("OUTCOME_UNKNOWN");
  });
  it("reuses a successful cached response after business commit fails", async () => {
    const { runner, repo, owner, p, accepted, step } = await fixture();
    let calls = 0;
    const call = async () => {
      calls++;
      return result;
    };
    await expect(
      runner.executeStep(
        { owner_id: owner, project_id: p.id },
        accepted.run_id,
        step,
        call,
        () => {
          throw new Error("crash before business commit");
        },
      ),
    ).rejects.toThrow("crash");
    await runner.control(
      { owner_id: owner, project_id: p.id },
      accepted.run_id,
      "retry",
    );
    await new TaskRunner(repo).executeStep(
      { owner_id: owner, project_id: p.id },
      accepted.run_id,
      step,
      call,
      () => ({}),
    );
    expect(calls).toBe(1);
  });
  it("cannot resume a cancelled run", async () => {
    const { runner, owner, p, accepted } = await fixture();
    await runner.control(
      { owner_id: owner, project_id: p.id },
      accepted.run_id,
      "cancel",
    );
    await expect(
      runner.control(
        { owner_id: owner, project_id: p.id },
        accepted.run_id,
        "resume",
      ),
    ).rejects.toMatchObject({ code: "INVALID_STAGE" });
  });
  it("validates run controls before persisting a new command", async () => {
    const { repo, owner, p } = await fixture();
    const namespace = (
      env as unknown as {
        PROJECT_SUPERVISOR: DurableObjectNamespace<ProjectSupervisor>;
      }
    ).PROJECT_SUPERVISOR;
    const parent = namespace.get(namespace.idFromName(owner + ":" + p.id));
    await parent.bindProject({ owner_id: owner }, p.id);
    const before = await repo.readWorkspace(p.id);
    const code = await runInDurableObject(parent, async (instance) => {
      try {
        await instance.accept(
          { owner_id: owner },
          {
            client_operation_id: crypto.randomUUID(),
            expected_revision: before.project.revision,
            command: { type: "pause_run", run_id: "another-project-run" },
          },
        );
        return null;
      } catch (error) {
        return error instanceof Error && "code" in error
          ? String(error.code)
          : "unknown";
      }
    });
    expect(code).toBe("FORBIDDEN");
    expect((await repo.readWorkspace(p.id)).runs).toHaveLength(1);
  });
  it("supplementing requirements invalidates the old generation", async () => {
    const { repo, owner, p, accepted } = await fixture();
    const namespace = (
      env as unknown as {
        PROJECT_SUPERVISOR: DurableObjectNamespace<ProjectSupervisor>;
      }
    ).PROJECT_SUPERVISOR;
    const parent = namespace.get(namespace.idFromName(owner + ":" + p.id));
    await parent.bindProject({ owner_id: owner }, p.id);
    const current = await repo.getProject(owner, p.id);
    await parent.accept(
      { owner_id: owner },
      {
        client_operation_id: crypto.randomUUID(),
        expected_revision: current.revision,
        command: {
          type: "supplement_requirements",
          text: "补充：我想先理解工具调用边界",
        },
      },
    );
    const after = await repo.readWorkspace(p.id);
    expect(after.project.run_epoch).toBeGreaterThan(0);
    expect(after.runs.find((r) => r.id === accepted.run_id)?.status).toBe(
      "cancelled",
    );
  });
});
