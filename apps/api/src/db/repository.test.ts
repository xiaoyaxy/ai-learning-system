import { beforeAll, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { ProjectRepository } from "./repository";
import migration from "./migrations/0001_initial.sql?raw";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
});
async function fixture() {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID();
  const input = {
    client_operation_id: crypto.randomUUID(),
    name: "Agent",
    goal_text: "理解 Agent",
    time_constraint_text: "两周",
    timezone: "Asia/Shanghai",
  };
  const p1 = await repo.create(owner, input);
  const p2 = await repo.create(owner, {
    ...input,
    client_operation_id: crypto.randomUUID(),
    name: "SQL",
  });
  return {
    repo,
    owner,
    p1,
    p2,
    input,
    ctx: { owner_id: owner, project_id: p1.id },
    command: {
      client_operation_id: crypto.randomUUID(),
      expected_revision: 0,
      command: {
        type: "send_message" as const,
        text: "我想学 Agent",
        mode: "message" as const,
      },
    },
  };
}
async function count(projectId: string) {
  return Number(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM artifacts WHERE project_id=?")
        .bind(projectId)
        .first<{ n: number }>()
    )?.n,
  );
}
describe("project facts and receipts", () => {
  it("replays a creation and rejects changed content using the same id", async () => {
    const { repo, owner, p1, input } = await fixture();
    expect((await repo.create(owner, input)).id).toBe(p1.id);
    await expect(
      repo.create(owner, { ...input, name: "别的" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("replays the command without another raw message", async () => {
    const { repo, p1, ctx, command } = await fixture();
    const first = await repo.acceptCommand(ctx, command);
    expect(await repo.acceptCommand(ctx, command)).toEqual({
      ...first,
      replayed: true,
    });
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE project_id=?")
      .bind(p1.id)
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
  it("rejects changed payload and keeps the first answer verbatim", async () => {
    const { repo, ctx, command } = await fixture();
    await repo.acceptCommand(ctx, command);
    await expect(
      repo.acceptCommand(ctx, {
        ...command,
        command: { ...command.command, text: "另一份正文" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await repo.readWorkspace(ctx.project_id)).messages[0].body).toBe(
      "我想学 Agent",
    );
  });
  it("checks ownership before returning a duplicate receipt", async () => {
    const { repo, ctx, command } = await fixture();
    await repo.acceptCommand(ctx, command);
    await expect(
      repo.acceptCommand({ ...ctx, owner_id: "other" }, command),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("accepts concurrent duplicates exactly once", async () => {
    const { repo, ctx, command } = await fixture();
    const values = await Promise.all([
      repo.acceptCommand(ctx, command),
      repo.acceptCommand(ctx, command),
    ]);
    expect(values[0].run_id).toBe(values[1].run_id);
    expect((await repo.readWorkspace(ctx.project_id)).messages).toHaveLength(1);
  });
  it("rolls back a stale step before any artifacts are inserted", async () => {
    const { repo, owner, p1 } = await fixture();
    await expect(
      repo.commitStep(
        {
          owner_id: owner,
          project_id: p1.id,
          operation_id: "op",
          step_key: "old",
          base_revision: 1,
          epoch: 0,
          actor: "planner",
        },
        {
          entities: [
            {
              table: "artifacts",
              row: { id: "a", kind: "plan", version: 1, content: "old" },
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await count(p1.id)).toBe(0);
  });
  it("replays a committed step and rejects late epochs", async () => {
    const { repo, owner, p1 } = await fixture();
    const ctx = {
      owner_id: owner,
      project_id: p1.id,
      operation_id: "op",
      step_key: "plan",
      base_revision: 0,
      epoch: 0,
      actor: "planner" as const,
    };
    const writes = {
      entities: [
        {
          table: "artifacts" as const,
          row: {
            id: crypto.randomUUID(),
            kind: "plan",
            version: 1,
            content: "plan",
          },
        },
      ],
    };
    const receipt = await repo.commitStep(ctx, writes);
    expect(await repo.commitStep(ctx, writes)).toEqual(receipt);
    await db
      .prepare("UPDATE projects SET run_epoch=1 WHERE id=?")
      .bind(p1.id)
      .run();
    await expect(
      repo.commitStep({ ...ctx, step_key: "late", base_revision: 1 }, writes),
    ).rejects.toMatchObject({ code: "STALE_EPOCH" });
    expect(await count(p1.id)).toBe(1);
  });
  it("blocks replacing or deleting diagnosis and raw messages", async () => {
    const { repo, owner, p1, ctx, command } = await fixture();
    const accepted = await repo.acceptCommand(ctx, command);
    await repo.commitStep(
      {
        owner_id: owner,
        project_id: p1.id,
        operation_id: command.client_operation_id,
        step_key: "diagnosis",
        base_revision: accepted.revision,
        epoch: 0,
        actor: "planner",
      },
      {
        entities: [
          {
            table: "artifacts",
            row: {
              id: "diagnosis",
              kind: "diagnosis",
              version: 1,
              content: "我还说不清",
            },
          },
        ],
      },
    );
    expect(
      (await repo.readWorkspace(p1.id)).artifacts.find(
        (a) => a.id === "diagnosis",
      )?.content,
    ).toBe("我还说不清");
    await expect(
      db
        .prepare("UPDATE artifacts SET content=? WHERE project_id=? AND id=?")
        .bind("改写", p1.id, "diagnosis")
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare("DELETE FROM artifacts WHERE project_id=? AND id=?")
        .bind(p1.id, "diagnosis")
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare("UPDATE messages SET body=? WHERE project_id=?")
        .bind("润色", p1.id)
        .run(),
    ).rejects.toThrow();
  });
  it("rejects cross-project question references and rolls back the whole batch", async () => {
    const { repo, owner, p1, p2 } = await fixture();
    await repo.commitStep(
      {
        owner_id: owner,
        project_id: p2.id,
        operation_id: "q",
        step_key: "create",
        base_revision: 0,
        epoch: 0,
        actor: "coach",
      },
      {
        entities: [
          {
            table: "assessment_sessions",
            row: {
              id: "s",
              purpose: "practice",
              goal_version: 1,
              status: "active",
              question_ids_json: "[]",
              required_skills_json: "[]",
            },
          },
          {
            table: "quiz_questions",
            row: {
              id: "q",
              session_id: "s",
              version: 1,
              prompt: "说明 Agent",
              skill_id: "concept",
              kind: "concept",
            },
          },
        ],
      },
    );
    await expect(
      repo.commitStep(
        {
          owner_id: owner,
          project_id: p1.id,
          operation_id: "bad",
          step_key: "commit",
          base_revision: 0,
          epoch: 0,
          actor: "coach",
        },
        {
          entities: [
            {
              table: "artifacts",
              row: {
                id: "should-rollback",
                kind: "review_comments",
                version: 1,
                content: "bad",
              },
            },
            {
              table: "question_secrets",
              row: {
                question_id: "q",
                reference_answer: "SECRET",
                rubric_json: "{}",
                explanation: "解析",
              },
            },
          ],
        },
      ),
    ).rejects.toThrow();
    expect(await count(p1.id)).toBe(0);
  });
  it("keeps raw quiz answers append-only", async () => {
    const { repo, owner, p1 } = await fixture();
    await repo.commitStep(
      {
        owner_id: owner,
        project_id: p1.id,
        operation_id: "answer",
        step_key: "seed",
        base_revision: 0,
        epoch: 0,
        actor: "coach",
      },
      {
        entities: [
          {
            table: "assessment_sessions",
            row: {
              id: "s",
              purpose: "practice",
              goal_version: 1,
              status: "active",
              question_ids_json: "[]",
              required_skills_json: "[]",
            },
          },
          {
            table: "quiz_questions",
            row: {
              id: "q",
              session_id: "s",
              version: 1,
              prompt: "什么是 Agent",
              skill_id: "concept",
              kind: "concept",
            },
          },
          {
            table: "messages",
            row: {
              id: "answer-message",
              sender_role: "user",
              body: "我还不太懂",
            },
          },
          {
            table: "quiz_attempts",
            row: {
              id: "attempt",
              question_id: "q",
              attempt_index: 1,
              answer_message_id: "answer-message",
            },
          },
        ],
      },
    );
    expect((await repo.readWorkspace(p1.id)).attempts).toHaveLength(1);
    await expect(
      db
        .prepare("UPDATE quiz_attempts SET attempt_index=2 WHERE project_id=?")
        .bind(p1.id)
        .run(),
    ).rejects.toThrow("IMMUTABLE_RECORD");
    await expect(
      db
        .prepare("DELETE FROM quiz_attempts WHERE project_id=?")
        .bind(p1.id)
        .run(),
    ).rejects.toThrow("IMMUTABLE_RECORD");
  });
});

it("reads revision and messages from one consistent snapshot during a concurrent write", async () => {
  const { repo, owner, p1, ctx, command } = await fixture();
  await repo.acceptCommand(ctx, command);
  let injected = false;
  const wrapped = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (sql === "SELECT * FROM projects WHERE id=?")
            return new Proxy(stmt, {
              get(s, k) {
                if (k === "bind")
                  return (...args: any[]) => {
                    const bound = s.bind(...args);
                    return new Proxy(bound, {
                      get(b, method) {
                        if (method === "first")
                          return async () => {
                            const old = await b.first();
                            if (!injected) {
                              injected = true;
                              await repo.commitStep(
                                {
                                  ...ctx,
                                  operation_id: command.client_operation_id,
                                  step_key: "during-read",
                                  base_revision: 1,
                                  epoch: 0,
                                  actor: "planner",
                                },
                                {
                                  entities: [
                                    {
                                      table: "messages",
                                      row: {
                                        id: crypto.randomUUID(),
                                        sender_role: "planner",
                                        body: "concurrent",
                                      },
                                    },
                                  ],
                                },
                              );
                            }
                            return old;
                          };
                        const value = (b as any)[method];
                        return typeof value === "function"
                          ? value.bind(b)
                          : value;
                      },
                    });
                  };
                const value = (s as any)[k];
                return typeof value === "function" ? value.bind(s) : value;
              },
            });
          return stmt;
        };
      const value = (target as any)[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const w = await new ProjectRepository(wrapped).readWorkspace(p1.id);
  expect(w.project.revision).toBe(w.messages.length);
});

it("atomically accepts pause/resume/cancel and never leaves a queued control run", async () => {
  const { repo, ctx, command, p1 } = await fixture();
  const target = await repo.acceptCommand(ctx, command);
  let w = await repo.readWorkspace(p1.id);
  const pause = {
    client_operation_id: crypto.randomUUID(),
    expected_revision: w.project.revision,
    command: { type: "pause_run" as const, run_id: target.run_id },
  };
  const accepted = await repo.acceptCommand(ctx, pause);
  w = await repo.readWorkspace(p1.id);
  expect(w.runs.find((r) => r.id === target.run_id)).toMatchObject({
    status: "paused",
    epoch: w.project.run_epoch,
  });
  expect(w.runs.find((r) => r.id === accepted.run_id)?.status).toBe(
    "succeeded",
  );
  expect(w.project.active_run_id).toBe(target.run_id);
  const epoch = w.project.run_epoch;
  await repo.acceptCommand(ctx, pause);
  expect((await repo.readWorkspace(p1.id)).project.run_epoch).toBe(epoch);
  await repo.acceptCommand(ctx, {
    client_operation_id: crypto.randomUUID(),
    expected_revision: w.project.revision,
    command: { type: "resume_run", run_id: target.run_id },
  });
  w = await repo.readWorkspace(p1.id);
  expect(w.runs.find((r) => r.id === target.run_id)).toMatchObject({
    status: "queued",
    epoch: w.project.run_epoch,
  });
  await repo.acceptCommand(ctx, {
    client_operation_id: crypto.randomUUID(),
    expected_revision: w.project.revision,
    command: { type: "cancel_run", run_id: target.run_id },
  });
  w = await repo.readWorkspace(p1.id);
  expect(w.runs.find((r) => r.id === target.run_id)?.status).toBe("cancelled");
  expect(
    w.runs.filter((r) => ["queued", "running"].includes(r.status)),
  ).toHaveLength(0);
  await expect(
    repo.acceptCommand(ctx, {
      ...command,
      client_operation_id: crypto.randomUUID(),
      expected_revision: w.project.revision,
    }),
  ).resolves.toHaveProperty("run_id");
});
it("atomically stops the old generation and queues supplemental requirements", async () => {
  const { repo, ctx, command, p1 } = await fixture();
  const target = await repo.acceptCommand(ctx, command);
  const before = await repo.readWorkspace(p1.id);
  const c = {
    client_operation_id: crypto.randomUUID(),
    expected_revision: before.project.revision,
    command: { type: "supplement_requirements" as const, text: "先学工具边界" },
  };
  const a = await repo.acceptCommand(ctx, c);
  const w = await repo.readWorkspace(p1.id);
  expect(w.runs.find((r) => r.id === target.run_id)?.status).toBe("cancelled");
  expect(w.runs.find((r) => r.id === a.run_id)).toMatchObject({
    status: "queued",
    epoch: before.project.run_epoch + 1,
  });
  expect(w.project.run_epoch).toBe(before.project.run_epoch + 1);
  await repo.acceptCommand(ctx, c);
  expect((await repo.readWorkspace(p1.id)).project.run_epoch).toBe(
    w.project.run_epoch,
  );
});
