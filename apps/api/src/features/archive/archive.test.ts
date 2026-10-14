import { beforeAll, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import migration from "../../db/migrations/0001_initial.sql?raw";
import reviewMigration from "../../db/migrations/0002_review_goal_version.sql?raw";
import { ProjectRepository } from "../../db/repository";
import { ArchiveService } from "./service";
import { reviewDates } from "./review";
import { exportProject } from "./export";
import { toWorkspaceDTO } from "../../http/projector";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
  await db.exec(reviewMigration);
});
async function fixture(text = "我懂了一点") {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID(),
    p = await repo.create(owner, {
      client_operation_id: crypto.randomUUID(),
      name: "学习",
      goal_text: "理解 Agent",
      time_constraint_text: "两周",
      timezone: "Asia/Shanghai",
    }),
    op = crypto.randomUUID(),
    a = await repo.acceptCommand(
      { owner_id: owner, project_id: p.id },
      {
        client_operation_id: op,
        expected_revision: 0,
        command: { type: "send_message", mode: "message", text },
      },
    ),
    ctx = {
      owner_id: owner,
      project_id: p.id,
      operation_id: op,
      step_key: "archive",
      run_id: a.run_id,
      base_revision: 1,
      epoch: 0,
      actor: "curator" as const,
    };
  const message = (await repo.readWorkspace(p.id)).messages[0];
  const execute = async () => ({
    kind: "learning_card",
    content: {
      problem: { text: "我懂了一点", message_id: message.id },
      understood_points: [{ text: "我懂了一点", message_id: message.id }],
      helpful_example: null,
      unclear: null,
      skill_id: "concept",
    },
    evidence_ids: [message.id],
    usage: null,
  });
  return {
    repo,
    owner,
    p,
    ctx,
    message,
    service: new ArchiveService(repo, execute),
  };
}
it("adds calendar days in the project timezone, including DST", () => {
  expect(reviewDates("2026-10-13T16:30:00Z", "Asia/Shanghai")).toEqual({
    day1: "2026-10-15",
    day3: "2026-10-17",
  });
  expect(reviewDates("2026-11-01T04:30:00Z", "America/New_York")).toEqual({
    day1: "2026-11-02",
    day3: "2026-11-04",
  });
});
it("asks for missing understanding rather than inventing three points", async () => {
  const { service, repo, p, ctx, message } = await fixture();
  const card = await service.createLearningCard(ctx, [message.id]);
  expect(card.missing_fields).toContain("understood_points");
  expect(
    (await repo.readWorkspace(p.id)).artifacts.filter(
      (a) => a.kind === "learning_card",
    ),
  ).toHaveLength(0);
});
it("preserves the entire draft and only produces review comments", async () => {
  const text = "我自己的草稿，标点、口语都保留。\n\n这是第二段。",
    { service, repo, p, ctx } = await fixture(text);
  const draft = await service.submitUserArtifact(
    { ...ctx, actor: "trusted_ingress" },
    { kind: "draft", text },
  );
  expect(
    (await repo.readWorkspace(p.id)).artifacts.find((a) => a.id === draft.id)
      ?.content,
  ).toBe(text);
  const reviewer = new ArchiveService(repo, async () => ({
    kind: "review_comments",
    content: {
      comments: [
        {
          paragraph_index: 1,
          quote: "我自己的草稿",
          issue: "论点不够具体",
          action: "补充一个你亲自遇到的例子",
        },
      ],
      fact_checks: [
        {
          quote: "这是第二段",
          reason: "若包含版本或专业结论需要查证",
          status: "needs_manual_verification",
        },
      ],
    },
    evidence_ids: [],
    usage: null,
  }));
  const review = await reviewer.reviewDraft({ ...ctx, actor: "coach" }, draft);
  expect(review.kind).toBe("review_comments");
  expect(
    (await repo.readWorkspace(p.id)).artifacts.find((a) => a.id === draft.id)
      ?.content,
  ).toBe(text);
});
it("only curator can version or tombstone a note and keeps old versions", async () => {
  const { service, repo, p, ctx } = await fixture("我的笔记原话");
  await expect(
    service.saveNote({ ...ctx, actor: "coach" }, "我的笔记原话"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const note = await service.saveNote(ctx, "我的笔记原话");
  await expect(
    service.deleteNote({ ...ctx, actor: "planner" }, note),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await service.deleteNote(ctx, note);
  const w = await repo.readWorkspace(p.id);
  expect(w.artifacts.filter((a) => a.kind === "note")).toHaveLength(2);
  expect(w.artifacts.find((a) => a.id === note.id)?.content).toBe(
    "我的笔记原话",
  );
  expect(w.artifacts.filter((a) => a.kind === "note").at(-1)?.tombstone).toBe(
    1,
  );
});
it("keeps missed reviews pending and sends their IDs to the planner", async () => {
  const { service, repo, p, ctx } = await fixture();
  const refs = await service.scheduleReviews(ctx, {
    skill_id: "concept",
    learned_at: "2026-10-01T00:00:00Z",
    timezone: "Asia/Shanghai",
  });
  expect(refs).toHaveLength(2);
  const w = await repo.readWorkspace(p.id);
  expect(w.reviews.map((r) => r.status)).toEqual(["pending", "pending"]);
  expect(w.reviews.map((r) => r.due_date)).toEqual([
    "2026-10-02",
    "2026-10-04",
  ]);
  expect(
    (await repo.readEvents(p.id, 0, 50)).some(
      (e) => e.type === "handoff_committed",
    ),
  ).toBe(true);
});
it("collects the four weekly answers one at a time and computes statistics from facts", async () => {
  const { service, repo, owner, p, ctx } = await fixture();
  let context = { ...ctx };
  let pending = await service.startWeeklyReview(context);
  for (let i = 0; i < 4; i++) {
    const w = await repo.readWorkspace(p.id),
      op = crypto.randomUUID(),
      a = await repo.acceptCommand(
        { owner_id: owner, project_id: p.id },
        {
          client_operation_id: op,
          expected_revision: w.project.revision,
          command: {
            type: "send_message",
            mode: "message",
            text: `本周回答 ${i}`,
          },
        },
      );
    context = { ...ctx, operation_id: op, run_id: a.run_id };
    pending = await service.answerWeekly(context, `本周回答 ${i}`);
  }
  const w = await repo.readWorkspace(p.id),
    report = w.artifacts.find((a) => a.kind === "weekly_report");
  expect(report).toBeTruthy();
  expect(JSON.parse(report!.content)).toMatchObject({
    correct_count: 0,
    answers: expect.arrayContaining([
      expect.objectContaining({ text: "本周回答 0" }),
    ]),
  });
  expect(w.attempts).toHaveLength(4);
  expect(w.evaluations).toHaveLength(0);
  expect(w.project.pending_input_json).toBeNull();
});
it("exports only public evidence and renders unsafe user markup as literal text", async () => {
  const { repo, p, ctx } = await fixture(
    "```\n<script>alert(1)</script>\n[x](javascript:alert(1))",
  );
  await repo.commitStep(
    { ...ctx, base_revision: 1, step_key: "secret", actor: "coach" },
    {
      entities: [
        {
          table: "assessment_sessions",
          row: {
            id: "s",
            purpose: "practice",
            goal_version: 1,
            status: "active",
            question_ids_json: '["q"]',
            required_skills_json: '["concept"]',
          },
        },
        {
          table: "quiz_questions",
          row: {
            id: "q",
            session_id: "s",
            version: 1,
            prompt: "题目",
            skill_id: "concept",
            kind: "concept",
          },
        },
        {
          table: "question_secrets",
          row: {
            question_id: "q",
            reference_answer: "SECRET_CANARY",
            rubric_json: "{}",
            explanation: "SECRET_CANARY",
          },
        },
      ],
    },
  );
  const w = await repo.readWorkspace(p.id),
    output = exportProject(w, toWorkspaceDTO(w).artifacts);
  expect(output).not.toContain("SECRET_CANARY");
  expect(output).toContain("````text");
  expect(output).toContain("答题记录.md");
});

it("archives exactly three literal points, schedules from the learner message date, and replays once", async () => {
  const text =
      "我要理解结构。Agent 决策。工具执行。反馈修正。例子是学习助手。我不清楚长期记忆。",
    { repo, p, ctx, message } = await fixture(text);
  await repo.commitStep(
    { ...ctx, actor: "planner", step_key: "definition", base_revision: 1 },
    {
      entities: [
        {
          table: "artifacts",
          row: {
            id: "definition",
            kind: "definition",
            version: 1,
            content: JSON.stringify({ skills: ["concept"] }),
            evidence_message_ids: "[]",
          },
        },
      ],
    },
  );
  const q = (text: string) => ({ text, message_id: message.id }),
    service = new ArchiveService(repo, async () => ({
      kind: "learning_card",
      content: {
        problem: q("我要理解结构"),
        understood_points: [q("Agent 决策"), q("工具执行"), q("反馈修正")],
        helpful_example: q("例子是学习助手"),
        unclear: q("我不清楚长期记忆"),
        skill_id: "concept",
      },
      evidence_ids: [message.id],
      usage: null,
    }));
  await service.createLearningCard(ctx, [message.id]);
  await service.createLearningCard(ctx, [message.id]);
  const w = await repo.readWorkspace(p.id);
  expect(w.artifacts.filter((a) => a.kind === "learning_card")).toHaveLength(1);
  expect(w.reviews).toHaveLength(2);
  expect(w.reviews.map((r) => r.due_date)).toEqual(
    Object.values(
      reviewDates(
        message.created_at.includes("T")
          ? message.created_at
          : message.created_at.replace(" ", "T") + "Z",
        "Asia/Shanghai",
      ),
    ),
  );
});

it("replays a saved note update before checking its superseded base version", async () => {
  const { repo, ctx, p, service } = await fixture("第二版原话");
  await repo.commitStep(
    { ...ctx, step_key: "old-note" },
    {
      entities: [
        {
          table: "artifacts",
          row: {
            id: "old-note",
            kind: "note",
            version: 1,
            content: "第一版",
            evidence_message_ids: "[]",
          },
        },
      ],
    },
  );
  const base = {
    id: "old-note",
    project_id: p.id,
    kind: "note" as const,
    version: 1,
  };
  const a = await service.saveNote(ctx, "第二版原话", base);
  await expect(service.saveNote(ctx, "第二版原话", base)).resolves.toEqual(a);
  expect(
    (await repo.readWorkspace(p.id)).artifacts.filter((a) => a.kind === "note"),
  ).toHaveLength(2);
});
