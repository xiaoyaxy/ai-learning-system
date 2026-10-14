import deletionMigration from "./migrations/0003_project_deletions.sql?raw";
import { beforeAll, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import initial from "./migrations/0001_initial.sql?raw";
import { ProjectRepository } from "./repository";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(initial);
  await db.exec(deletionMigration);
});
async function fixture() {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID();
  const p = await repo.create(owner, {
    client_operation_id: crypto.randomUUID(),
    name: "可删除测试群",
    goal_text: "学习",
    time_constraint_text: "",
    timezone: "Asia/Shanghai",
  });
  const ctx = { owner_id: owner, project_id: p.id };
  await repo.acceptCommand(ctx, {
    client_operation_id: crypto.randomUUID(),
    expected_revision: 0,
    command: { type: "send_message", mode: "message", text: "保留的用户原话" },
  });
  return { repo, owner, p, ctx };
}
it("soft delete hides the project, cancels work, preserves facts and restore keeps history", async () => {
  const { repo, owner, p, ctx } = await fixture();
  await expect(repo.deleteProject("other", p.id, false)).rejects.toThrow(
    "FORBIDDEN",
  );
  await repo.deleteProject(owner, p.id, false);
  await repo.deleteProject(owner, p.id, false);
  expect(await repo.listProjects(owner)).toHaveLength(0);
  expect(await repo.listDeletedProjects(owner)).toHaveLength(1);
  await expect(repo.getProject(owner, p.id)).rejects.toThrow("FORBIDDEN");
  await expect(repo.readWorkspace(p.id)).rejects.toThrow("FORBIDDEN");
  expect(
    (
      await db
        .prepare("SELECT body FROM messages WHERE project_id=?")
        .bind(p.id)
        .first()
    )?.body,
  ).toBe("保留的用户原话");
  expect(
    (
      await db
        .prepare("SELECT status FROM agent_runs WHERE project_id=?")
        .bind(p.id)
        .first()
    )?.status,
  ).toBe("cancelled");
  await expect(
    repo.commitStep(
      {
        ...ctx,
        operation_id: "late",
        step_key: "late",
        epoch: 0,
        base_revision: 1,
        actor: "runtime",
      },
      { result: {} },
    ),
  ).rejects.toThrow();
  await repo.restoreProject(owner, p.id);
  expect((await repo.readWorkspace(p.id)).messages).toHaveLength(1);
  expect(await repo.listDeletedProjects(owner)).toHaveLength(0);
});
it("permanent deletion requires the exact name and removes every related row while other projects remain immutable", async () => {
  const { repo, owner, p } = await fixture(),
    other = await fixture();
  await expect(
    repo.deleteProject(owner, p.id, true, "错误名称"),
  ).rejects.toThrow();
  expect((await repo.readWorkspace(p.id)).messages).toHaveLength(1);
  await repo.deleteProject(owner, p.id, true, p.name);
  for (const table of [
    "projects",
    "messages",
    "agent_runs",
    "command_receipts",
    "project_creation_receipts",
    "project_deletions",
    "domain_events",
    "artifacts",
    "sources",
  ]) {
    const column = table === "projects" ? "id" : "project_id";
    expect(
      (
        await db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`)
          .bind(p.id)
          .first()
      )?.n,
    ).toBe(0);
  }
  expect(await repo.isUnavailable(p.id)).toBe(true);
  await expect(
    db
      .prepare("DELETE FROM messages WHERE project_id=?")
      .bind(other.p.id)
      .run(),
  ).rejects.toThrow("IMMUTABLE");
  expect((await other.repo.readWorkspace(other.p.id)).messages).toHaveLength(1);
});
it("restores the pending user interaction after a recoverable deletion", async () => {
  const { repo, owner, p } = await fixture();
  const pending = JSON.stringify({
    kind: "start_learning",
    entity_id: "plan",
    version: 1,
    expected_role: "supervisor",
  });
  await db
    .prepare("UPDATE projects SET pending_input_json=? WHERE id=?")
    .bind(pending, p.id)
    .run();
  await repo.deleteProject(owner, p.id, false);
  await repo.restoreProject(owner, p.id);
  expect((await repo.getProject(owner, p.id)).pending_input_json).toBe(pending);
});
it("resumes permanent runtime cleanup after D1 is purged and a facet cleanup fails", async () => {
  const { ProjectSupervisor } = await import("../agents/project-supervisor");
  const { vi } = await import("vitest");
  const { repo, owner, p } = await fixture();
  const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("interrupted facet cleanup"))
      .mockResolvedValue(undefined),
    destroy = vi.fn();
  const state = {
    owner_id: owner,
    project_id: p.id,
    purge_pending: true,
    purge_name: p.name,
  };
  const fake = {
    state,
    env: { DB: db },
    context: () => ({ owner_id: owner, project_id: p.id }),
    dynamicAgents: { abort: vi.fn(), delete: remove },
    listSchedules: async () => [
      { id: "backstop", callback: "finishPermanentDeletion" },
    ],
    cancelSchedule: vi.fn(),
    _cf_scheduleDestroy: destroy,
  };
  const finish = () =>
    ProjectSupervisor.prototype.finishPermanentDeletion.call(fake as any);
  await expect(finish()).rejects.toThrow("interrupted");
  expect(await repo.isUnavailable(p.id)).toBe(true);
  expect(state.purge_pending).toBe(true);
  await finish();
  expect(remove).toHaveBeenCalledTimes(4);
  expect(destroy).toHaveBeenCalledOnce();
  expect(fake.cancelSchedule).not.toHaveBeenCalledWith("backstop");
});
