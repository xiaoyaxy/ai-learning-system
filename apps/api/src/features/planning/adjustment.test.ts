import { beforeAll, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import migration from "../../db/migrations/0001_initial.sql?raw";
import { ProjectRepository } from "../../db/repository";
import { PlanningService } from "./service";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
});
async function setup(affected = false) {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID(),
    p = await repo.create(owner, {
      client_operation_id: crypto.randomUUID(),
      name: "目标",
      goal_text: "学习 Agent",
      time_constraint_text: "2026-10-28",
      timezone: "Asia/Shanghai",
    }),
    op = crypto.randomUUID(),
    accepted = await repo.acceptCommand(
      { owner_id: owner, project_id: p.id },
      {
        client_operation_id: op,
        expected_revision: 0,
        command: { type: "send_message", mode: "message", text: "调整" },
      },
    ),
    ctx = {
      owner_id: owner,
      project_id: p.id,
      operation_id: op,
      run_id: accepted.run_id,
      base_revision: 1,
      epoch: 0,
      actor: "planner" as const,
      step_key: "seed",
    },
    plan = {
      milestones: ["掌握"],
      tasks: [
        {
          goal: "学习 Agent",
          skill_id: "concept",
          material_ids: ["m"],
          output: "独立解释",
        },
      ],
      time_setting: null,
      time_constraint_text: "2026-10-28",
    };
  await repo.commitStep(ctx, {
    entities: [
      {
        table: "artifacts",
        row: {
          id: "plan",
          kind: "plan",
          version: 1,
          content: JSON.stringify(plan),
          evidence_message_ids: "[]",
        },
      },
      {
        table: "sources",
        row: {
          id: "m",
          goal_version: 1,
          reference_no: "M01",
          layer: "intro",
          title: "资料",
          url: "https://example.com",
          fetched_at: "2026-10-14T00:00:00Z",
          status: "accessible",
          verification_status: "pending",
          summary: "资料",
          citations_json: "[]",
        },
      },
    ],
    project_changes: { active_plan_id: "plan", phase: "learning" },
    events: [
      {
        type: "handoff_committed",
        role: "supervisor",
        payload: {
          from: "coach",
          to: "supervisor",
          entity_id: "feedback",
          text: "反馈交接",
        },
      },
    ],
  });
  // A real immutable answer/evaluation with foreign keys.
  const current = await repo.getProject(owner, p.id);
  await repo.commitStep(
    {
      ...ctx,
      actor: "coach",
      step_key: "evidence",
      base_revision: current.revision,
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
            prompt: "题",
            skill_id: "concept",
            kind: "concept",
          },
        },
        {
          table: "quiz_attempts",
          row: {
            id: "a",
            question_id: "q",
            attempt_index: 1,
            answer_message_id: (await repo.readWorkspace(p.id)).messages[0].id,
          },
        },
        {
          table: "quiz_evaluations",
          row: {
            id: "feedback",
            attempt_id: "a",
            verdict: "incorrect",
            gap: "concept_confusion",
            feedback: "区分概念",
            reveal_allowed: 1,
          },
        },
      ],
    },
  );
  const service = new PlanningService(repo, async () => ({
    kind: "adjustment",
    content: {
      plan: { ...plan, tasks: plan.tasks },
      changed_constraints: affected
        ? [{ kind: "time", raw_text: "2026-10-29" }]
        : [],
      estimated_finish: affected ? "2026-10-29" : null,
      estimate_basis: affected
        ? "补充练习需要一天"
        : "保持已有任务，仅替换材料",
      potentially_delays: affected,
      summary: "依据反馈调整",
    },
    evidence_ids: ["feedback"],
    usage: null,
  }));
  return { repo, owner, p, ctx, service };
}
it("automatically activates a safe adjustment and replays it once", async () => {
  const { repo, p, ctx, service } = await setup();
  await service.proposeAdjustment(ctx, "feedback");
  await service.proposeAdjustment(ctx, "feedback");
  const w = await repo.readWorkspace(p.id);
  expect(w.artifacts.filter((a) => a.kind === "plan")).toHaveLength(2);
  expect(w.project.active_plan_id).not.toBe("plan");
  expect(w.project.time_constraint_text).toBe("2026-10-28");
  expect(w.proposals[0].status).toBe("activated");
});
it("keeps the old plan until a current real user decision, then marks completion stale", async () => {
  const { repo, owner, p, ctx, service } = await setup(true);
  const proposal = await service.proposeAdjustment(ctx, "feedback");
  let w = await repo.readWorkspace(p.id);
  expect(w.project.active_plan_id).toBe("plan");
  expect(w.project.time_constraint_text).toBe("2026-10-28");
  const op = crypto.randomUUID(),
    a = await repo.acceptCommand(
      { owner_id: owner, project_id: p.id },
      {
        client_operation_id: op,
        expected_revision: w.project.revision,
        command: {
          type: "decide_proposal",
          proposal_id: proposal.id,
          proposal_version: 1,
          decision: "accept",
        },
      },
    );
  const decisionCtx = { ...ctx, operation_id: op, run_id: a.run_id };
  await expect(
    service.recordDecision(decisionCtx, {
      proposal_id: proposal.id,
      proposal_version: 2,
      decision: "accept",
    }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await service.recordDecision(decisionCtx, {
    proposal_id: proposal.id,
    proposal_version: 1,
    decision: "accept",
  });
  await service.recordDecision(decisionCtx, {
    proposal_id: proposal.id,
    proposal_version: 1,
    decision: "accept",
  });
  w = await repo.readWorkspace(p.id);
  expect(w.project).toMatchObject({
    goal_version: 2,
    time_constraint_text: "2026-10-29",
    phase: "learning",
  });
  expect(JSON.parse(w.project.completion_json!).status).toBe("stale");
});
for (const decision of ["retain", "pause"] as const)
  it(`keeps the original constraints on ${decision}`, async () => {
    const { repo, owner, p, ctx, service } = await setup(true),
      proposal = await service.proposeAdjustment(ctx, "feedback"),
      w = await repo.readWorkspace(p.id),
      op = crypto.randomUUID(),
      a = await repo.acceptCommand(
        { owner_id: owner, project_id: p.id },
        {
          client_operation_id: op,
          expected_revision: w.project.revision,
          command: {
            type: "decide_proposal",
            proposal_id: proposal.id,
            proposal_version: proposal.version,
            decision,
          },
        },
      );
    await service.recordDecision(
      { ...ctx, operation_id: op, run_id: a.run_id },
      {
        proposal_id: proposal.id,
        proposal_version: proposal.version,
        decision,
      },
    );
    const after = await repo.readWorkspace(p.id);
    expect(after.project.goal_version).toBe(1);
    expect(after.project.time_constraint_text).toBe("2026-10-28");
    expect(after.project.active_plan_id === w.project.active_plan_id).toBe(
      decision === "pause",
    );
    expect(after.proposals[0].status).toBe(
      decision === "pause" ? "paused" : "retained",
    );
  });

it("re-evaluates saved user requirements through the supervisor without inventing a coach grade", async () => {
  const { repo, p, ctx } = await setup(),
    w = await repo.readWorkspace(p.id),
    message = w.messages[0];
  let input: any;
  const service = new PlanningService(repo, async (task) => {
    input = task.public_context;
    return {
      kind: "adjustment",
      content: {
        plan: JSON.parse(w.artifacts.find((a) => a.id === "plan")!.content),
        changed_constraints: [],
        estimated_finish: null,
        estimate_basis: "只调整已有任务顺序",
        potentially_delays: false,
        summary: "按用户补充要求重排",
      },
      evidence_ids: [message.id],
      usage: null,
    };
  });
  await service.proposeRequirements(ctx, message.id);
  expect(input.requested_changes).toBe(message.body);
  expect((await repo.readWorkspace(p.id)).proposals).toHaveLength(1);
});
