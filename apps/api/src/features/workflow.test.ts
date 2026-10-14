import deletionMigration from "../db/migrations/0003_project_deletions.sql?raw";
import { beforeAll, afterEach, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { ProjectRepository } from "../db/repository";
import migration from "../db/migrations/0001_initial.sql?raw";
import reviewMigration from "../db/migrations/0002_review_goal_version.sql?raw";
import { runLearningCommand } from "./workflow";
import { PlanningService } from "./planning/service";
import { ResourceService } from "./resources/service";
import { ArchiveService } from "./archive/service";
import type { Env } from "../env";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
  await db.exec(reviewMigration);
  await db.exec(deletionMigration);
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID(),
    p = await repo.create(owner, {
      client_operation_id: crypto.randomUUID(),
      name: "Recovery",
      goal_text: "学习",
      time_constraint_text: "",
      timezone: "Asia/Shanghai",
    }),
    ctx = { owner_id: owner, project_id: p.id };
  return { repo, p, ctx };
}
const execute = async () => ({
  kind: "message",
  content: { text: "reply" },
  evidence_ids: [],
  usage: null,
});
it("waits for explicit start after the overall plan and replays the confirmation once", async () => {
  const { repo, p, ctx } = await fixture();
  await db
    .prepare("UPDATE projects SET phase='diagnosis' WHERE id=?")
    .bind(p.id)
    .run();
  const command = {
      type: "send_message" as const,
      mode: "message" as const,
      text: "原始诊断",
    },
    a = await repo.acceptCommand(ctx, {
      client_operation_id: crypto.randomUUID(),
      expected_revision: 0,
      command,
    }),
    run = (await repo.readWorkspace(p.id)).runs[0];
  await repo.commitStep(
    {
      ...ctx,
      actor: "planner",
      operation_id: run.operation_id,
      epoch: 0,
      base_revision: 1,
      step_key: "definition",
    },
    {
      entities: [
        {
          table: "artifacts",
          row: {
            id: "def",
            kind: "definition",
            version: 1,
            content: "{}",
            evidence_message_ids: "[]",
          },
        },
      ],
    },
  );
  vi.spyOn(PlanningService.prototype, "saveDiagnosis").mockResolvedValue({
    id: "diagnosis",
    project_id: p.id,
    kind: "diagnosis",
    version: 1,
  });
  vi.spyOn(ResourceService.prototype, "prepare").mockResolvedValue({
    source_ids: [],
  } as any);
  vi.spyOn(PlanningService.prototype, "createPlan").mockImplementation(
    async (c) => {
      const w = await repo.readWorkspace(p.id);
      await repo.commitStep(
        { ...c, base_revision: w.project.revision, step_key: "test-plan" },
        { project_changes: { phase: "learning" } },
      );
      return { id: "plan", project_id: p.id, kind: "plan", version: 1 };
    },
  );
  const card = vi
    .spyOn(PlanningService.prototype, "createTaskCard")
    .mockResolvedValue({
      id: "card",
      project_id: p.id,
      kind: "task_card",
      version: 1,
    });
  const environment = { DEPLOYMENT_ENV: "local", DEMO_MODE: "true" } as Env;
  await runLearningCommand(repo, ctx, run, execute, command, environment);
  await runLearningCommand(repo, ctx, run, execute, command, environment);
  expect(card).not.toHaveBeenCalled();
  const waiting = await repo.readWorkspace(p.id);
  expect(JSON.parse(waiting.project.pending_input_json!).kind).toBe(
    "start_learning",
  );
  expect(
    waiting.messages.filter(
      (m) => m.sender_role === "supervisor" && m.body.includes("是否开始学习"),
    ),
  ).toHaveLength(1);
  const no = {
    type: "send_message" as const,
    mode: "message" as const,
    text: "先不开始",
  };
  const acceptNo = await repo.acceptCommand(ctx, {
    client_operation_id: crypto.randomUUID(),
    expected_revision: waiting.project.revision,
    command: no,
  });
  const noRun = (await repo.readWorkspace(p.id)).runs.find(
    (r) => r.id === acceptNo.run_id,
  )!;
  expect(await runLearningCommand(repo, ctx, noRun, execute, no)).toBe(false);
  expect(card).not.toHaveBeenCalled();
  await db
    .prepare("UPDATE agent_runs SET status='waiting_user' WHERE id=?")
    .bind(noRun.id)
    .run();
  const current = await repo.readWorkspace(p.id),
    yes = {
      type: "send_message" as const,
      mode: "message" as const,
      text: "开始",
    };
  const accepted = await repo.acceptCommand(ctx, {
    client_operation_id: crypto.randomUUID(),
    expected_revision: current.project.revision,
    command: yes,
  });
  const yesRun = (await repo.readWorkspace(p.id)).runs.find(
    (r) => r.id === accepted.run_id,
  )!;
  await runLearningCommand(repo, ctx, yesRun, execute, yes);
  expect(card).toHaveBeenCalledTimes(1);
});
it("replays the fourth weekly answer into one report after the answer committed", async () => {
  const { repo, p, ctx } = await fixture();
  const start = await repo.acceptCommand(ctx, {
    client_operation_id: crypto.randomUUID(),
    expected_revision: 0,
    command: { type: "start_weekly_review" },
  });
  const tool = (id: string, op: string) => ({
    ...ctx,
    run_id: id,
    operation_id: op,
    step_key: "weekly",
    base_revision: 0,
    epoch: 0,
    actor: "curator" as const,
  });
  let run = (await repo.readWorkspace(p.id)).runs.find(
    (r) => r.id === start.run_id,
  )!;
  const service = new ArchiveService(repo, execute);
  await service.startWeeklyReview(tool(run.id, run.operation_id));
  for (let i = 0; i < 3; i++) {
    const w = await repo.readWorkspace(p.id),
      a = await repo.acceptCommand(ctx, {
        client_operation_id: crypto.randomUUID(),
        expected_revision: w.project.revision,
        command: { type: "send_message", mode: "answer", text: "复盘" + i },
      });
    run = (await repo.readWorkspace(p.id)).runs.find((r) => r.id === a.run_id)!;
    await service.answerWeekly(tool(run.id, run.operation_id), "复盘" + i);
  }
  const w = await repo.readWorkspace(p.id),
    command = {
      type: "send_message" as const,
      mode: "answer" as const,
      text: "第四问原话",
    },
    a = await repo.acceptCommand(ctx, {
      client_operation_id: crypto.randomUUID(),
      expected_revision: w.project.revision,
      command,
    });
  run = (await repo.readWorkspace(p.id)).runs.find((r) => r.id === a.run_id)!;
  const real = ArchiveService.prototype.createWeeklyReport;
  vi.spyOn(ArchiveService.prototype, "createWeeklyReport")
    .mockRejectedValueOnce(new Error("interrupt before report"))
    .mockImplementation(real);
  await expect(
    runLearningCommand(repo, ctx, run, execute, command),
  ).rejects.toThrow("interrupt");
  await expect(
    runLearningCommand(repo, ctx, run, execute, command),
  ).resolves.toBe(true);
  await runLearningCommand(repo, ctx, run, execute, command);
  const after = await repo.readWorkspace(p.id);
  expect(after.attempts).toHaveLength(4);
  expect(
    after.artifacts.filter((a) => a.kind === "weekly_report"),
  ).toHaveLength(1);
  expect(after.artifacts.filter((a) => a.kind === "index")).toHaveLength(1);
  expect(after.evaluations).toHaveLength(0);
});
