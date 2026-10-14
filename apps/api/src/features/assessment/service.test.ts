import { beforeAll, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { ProjectRepository } from "../../db/repository";
import migration from "../../db/migrations/0001_initial.sql?raw";
import { AssessmentService } from "./service";
import { toWorkspaceDTO } from "../../http/projector";
import type { RoleResult } from "../../runtime/types";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
});
async function fixture(verdict = "incorrect") {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID(),
    p = await repo.create(owner, {
      client_operation_id: crypto.randomUUID(),
      name: "Agent",
      goal_text: "理解架构",
      time_constraint_text: "两周",
      timezone: "Asia/Shanghai",
    });
  const envelope = {
    client_operation_id: crypto.randomUUID(),
    expected_revision: 0,
    command: {
      type: "send_message" as const,
      mode: "answer" as const,
      text: "不确定",
    },
  };
  const accepted = await repo.acceptCommand(
    { owner_id: owner, project_id: p.id },
    envelope,
  );
  const ctx = {
    owner_id: owner,
    project_id: p.id,
    operation_id: envelope.client_operation_id,
    step_key: "seed",
    base_revision: 1,
    epoch: 0,
    actor: "coach" as const,
    run_id: accepted.run_id,
  };
  await repo.commitStep(ctx, {
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
          prompt: "Agent 与工具有什么区别？",
          skill_id: "concept",
          kind: "compare",
        },
      },
      {
        table: "question_secrets",
        row: {
          question_id: "q",
          reference_answer: "SECRET_CANARY",
          rubric_json: '{"criteria":["区分概念"]}',
          explanation: "参考解释：SECRET_CANARY",
        },
      },
    ],
    project_changes: {
      phase: "practicing",
      pending_input_json: JSON.stringify({
        kind: "answer",
        entity_id: "q",
        version: 1,
        expected_role: "coach",
      }),
    },
  });
  let calls = 0;
  const service = new AssessmentService(repo, async () => {
    calls++;
    return {
      kind: "evaluation",
      content: {
        verdict,
        gap_category: "concept_confusion",
        gap: "SECRET_CANARY",
        evidence_quote: "不确定",
      },
      evidence_ids: [],
      usage: null,
    } as RoleResult;
  });
  return { repo, owner, p, ctx, service, calls: () => calls };
}
describe("independent quiz answers", () => {
  it("keeps the first wrong feedback free of private reference and presents one followup", async () => {
    const { service, repo, p, ctx } = await fixture();
    const attempt = await service.submit(ctx, {
      question_id: "q",
      question_version: 1,
      attempt_index: 1,
      text: "不确定",
    });
    const evaluation = await service.evaluate(
      { ...ctx, step_key: "grade" },
      attempt,
    );
    expect(evaluation.reveal_allowed).toBe(false);
    const dto = toWorkspaceDTO(await repo.readWorkspace(p.id));
    expect(JSON.stringify(dto)).not.toContain("SECRET_CANARY");
    expect(dto.question?.attempt_index).toBe(2);
    expect(dto.question?.prompt).not.toBe("Agent 与工具有什么区别？");
    expect((await repo.readWorkspace(p.id)).attempts).toHaveLength(1);
  });
  it("reveals the explanation only after a real second answer", async () => {
    const { service, repo, owner, p, ctx } = await fixture();
    const first = await service.submit(ctx, {
      question_id: "q",
      question_version: 1,
      attempt_index: 1,
      text: "不确定",
    });
    await service.evaluate(ctx, first);
    const current = await repo.getProject(owner, p.id);
    const op = crypto.randomUUID(),
      accepted = await repo.acceptCommand(
        { owner_id: owner, project_id: p.id },
        {
          client_operation_id: op,
          expected_revision: current.revision,
          command: {
            type: "submit_answer",
            question_id: "q",
            question_version: 1,
            attempt_index: 2,
            text: "第二次回答",
          },
        },
      );
    const secondCtx = { ...ctx, operation_id: op, run_id: accepted.run_id };
    const second = await service.submit(secondCtx, {
      question_id: "q",
      question_version: 1,
      attempt_index: 2,
      text: "第二次回答",
    });
    const result = await service.evaluate(secondCtx, second);
    expect(result.reveal_allowed).toBe(true);
    expect((await repo.readWorkspace(p.id)).attempts).toHaveLength(2);
    expect(
      JSON.stringify(toWorkspaceDTO(await repo.readWorkspace(p.id))),
    ).toContain("参考解释：SECRET_CANARY");
  });
  it("replays one answer and one evaluation without duplicate records", async () => {
    const { service, repo, p, ctx, calls } = await fixture();
    const input = {
      question_id: "q",
      question_version: 1,
      attempt_index: 1,
      text: "不确定",
    };
    const a = await service.submit(ctx, input);
    expect(await service.submit(ctx, input)).toEqual(a);
    await service.evaluate(ctx, a);
    await service.evaluate(ctx, a);
    expect(calls()).toBe(1);
    expect((await repo.readWorkspace(p.id)).evaluations).toHaveLength(1);
  });
  it("rejects wrong question version and never turns uncertainty into a wrong score", async () => {
    const { service, repo, p, ctx } = await fixture("needs_review");
    await expect(
      service.submit(ctx, {
        question_id: "q",
        question_version: 2,
        attempt_index: 1,
        text: "不确定",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const a = await service.submit(ctx, {
      question_id: "q",
      question_version: 1,
      attempt_index: 1,
      text: "不确定",
    });
    const e = await service.evaluate(ctx, a);
    expect(e.verdict).toBe("needs_review");
    expect((await repo.readWorkspace(p.id)).evaluations[0].verdict).toBe(
      "needs_review",
    );
  });
});

describe("confirmed assessment policy and fixed sessions", () => {
  it("requires a real user confirmation, fixes the entire denominator, and completes at 4/5", async () => {
    const { repo, owner, p, ctx } = await fixture("correct");
    const current = await repo.getProject(owner, p.id);
    await repo.commitStep(
      {
        ...ctx,
        actor: "planner",
        step_key: "definition",
        base_revision: current.revision,
      },
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
        project_changes: { pending_input_json: null, phase: "learning" },
        run_changes: { run_id: ctx.run_id, status: "waiting_user" },
      },
    );
    const service = new AssessmentService(repo, async (task) => ({
      kind: task.action,
      content:
        task.action === "assessment_policy"
          ? {
              question_count: 5,
              required_skill_ids: ["concept"],
              rubric: {
                correct_criteria: ["区分概念"],
                uncertain_rule: "needs_review",
              },
              partial_rule: "count_incorrect",
              attempt_basis: "first",
              aggregation: "single_session",
              session_count: 1,
            }
          : task.action === "questions"
            ? {
                questions: (task.public_context.questions as unknown[]).map(
                  () => ({
                    prompt: "独立解释概念",
                    reference_answer: "PRIVATE",
                    explanation: "公开参考解释",
                    rubric: { criteria: ["区分概念"] },
                  }),
                ),
              }
            : {
                verdict: "correct",
                gap_category: "none",
                gap: "",
                evidence_quote: "",
              },
      evidence_ids: [],
      usage: null,
    }));
    let context = { ...ctx };
    async function command(command: any) {
      const project = await repo.getProject(owner, p.id),
        op = crypto.randomUUID(),
        a = await repo.acceptCommand(
          { owner_id: owner, project_id: p.id },
          {
            client_operation_id: op,
            expected_revision: project.revision,
            command,
          },
        );
      context = { ...ctx, operation_id: op, run_id: a.run_id };
      return context;
    }
    await command({ type: "start_completion_check" });
    expect(await service.start(context, "completion")).toBeNull();
    let w = await repo.readWorkspace(p.id);
    expect(w.policies.at(-1)?.status).toBe("draft");
    expect(w.sessions).toHaveLength(1); // practice fixture only
    const policy = JSON.parse(String(w.policies.at(-1)?.policy_json));
    await command({
      type: "confirm_assessment_policy",
      policy_id: policy.id,
      policy_version: policy.version,
    });
    await expect(
      service.confirmPolicy(context, {
        policy_id: policy.id,
        policy_version: 2,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await service.confirmPolicy(context, {
      policy_id: policy.id,
      policy_version: 1,
    });
    await command({ type: "start_completion_check" });
    const session = await service.start(context, "completion");
    w = await repo.readWorkspace(p.id);
    expect(
      w.questions.filter((q) => q.session_id === session?.id),
    ).toHaveLength(5);
    expect(JSON.stringify(toWorkspaceDTO(w))).not.toContain("PRIVATE");
    for (let i = 0; i < 5; i++) {
      const dto = toWorkspaceDTO(await repo.readWorkspace(p.id)),
        q = dto.question!;
      await command({
        type: "submit_answer",
        question_id: q.id,
        question_version: q.version,
        attempt_index: 1,
        text: "我的答案",
      });
      const a = await service.submit(context, {
        question_id: q.id,
        question_version: 1,
        attempt_index: 1,
        text: "我的答案",
      });
      await service.evaluate(context, a);
      if (i < 4)
        expect(
          toWorkspaceDTO(await repo.readWorkspace(p.id)).completion.status,
        ).toBe("in_progress");
    }
    expect(toWorkspaceDTO(await repo.readWorkspace(p.id))).toMatchObject({
      phase: "completed",
      completion: { status: "met", correct_count: 5, total_count: 5 },
    });
    await command({ type: "start_completion_check" });
    await service.start(context, "completion");
    expect(
      toWorkspaceDTO(await repo.readWorkspace(p.id)).completion.status,
    ).toBe("in_progress");
  });
});

it("rechecks an uncertain grade by appending an evaluation without another answer", async () => {
  const { repo, owner, p, ctx, service } = await fixture("needs_review"),
    attempt = await service.submit(ctx, {
      question_id: "q",
      question_version: 1,
      attempt_index: 1,
      text: "不确定",
    });
  await service.evaluate(ctx, attempt);
  const w = await repo.readWorkspace(p.id),
    op = crypto.randomUUID(),
    accepted = await repo.acceptCommand(
      { owner_id: owner, project_id: p.id },
      {
        client_operation_id: op,
        expected_revision: w.project.revision,
        command: { type: "reassess_answer", attempt_id: attempt.id },
      },
    );
  const rechecker = new AssessmentService(repo, async () => ({
    kind: "evaluation",
    content: {
      verdict: "correct",
      gap_category: "none",
      gap: "",
      evidence_quote: "不确定",
    },
    evidence_ids: [],
    usage: null,
  }));
  await rechecker.evaluate(
    { ...ctx, operation_id: op, run_id: accepted.run_id },
    attempt,
    { recheck: true },
  );
  await rechecker.evaluate(
    { ...ctx, operation_id: op, run_id: accepted.run_id },
    attempt,
    { recheck: true },
  );
  const after = await repo.readWorkspace(p.id);
  expect(after.attempts).toHaveLength(1);
  expect(after.evaluations).toHaveLength(2);
  expect(after.evaluations[1]).toMatchObject({
    verdict: "correct",
    supersedes_id: after.evaluations[0].id,
  });
});

it("versions a requested policy revision without overwriting the previous draft", async () => {
  const { repo, p, ctx } = await fixture(),
    w = await repo.readWorkspace(p.id);
  await repo.commitStep(
    {
      ...ctx,
      actor: "planner",
      step_key: "definition-revise",
      base_revision: w.project.revision,
    },
    {
      entities: [
        {
          table: "artifacts",
          row: {
            id: "def",
            kind: "definition",
            version: 1,
            content: JSON.stringify({ skills: ["concept"] }),
            evidence_message_ids: "[]",
          },
        },
      ],
      project_changes: { pending_input_json: null },
      run_changes: { run_id: ctx.run_id, status: "waiting_user" },
    },
  );
  let count = 5;
  const service = new AssessmentService(repo, async () => ({
    kind: "assessment_policy",
    content: {
      question_count: count,
      required_skill_ids: ["concept"],
      rubric: {
        correct_criteria: ["区分概念"],
        uncertain_rule: "needs_review",
      },
      partial_rule: "count_incorrect",
      attempt_basis: "first",
      aggregation: "single_session",
      session_count: 1,
    },
    evidence_ids: [],
    usage: null,
  }));
  const first = await service.proposePolicy(ctx);
  count = 6;
  const current = await repo.getProject(ctx.owner_id, p.id),
    op = crypto.randomUUID(),
    accepted = await repo.acceptCommand(
      { owner_id: ctx.owner_id, project_id: p.id },
      {
        client_operation_id: op,
        expected_revision: current.revision,
        command: {
          type: "revise_assessment_policy",
          policy_id: first.id,
          policy_version: 1,
          text: "改为六题",
        },
      },
    );
  const next = await service.proposePolicy(
    { ...ctx, operation_id: op, run_id: accepted.run_id },
    { policy_id: first.id, policy_version: 1, text: "改为六题" },
  );
  expect(next.version).toBe(2);
  expect((await repo.readWorkspace(p.id)).policies).toHaveLength(2);
});
