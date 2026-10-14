import { beforeAll, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { ProjectRepository } from "../../db/repository";
import migration from "../../db/migrations/0001_initial.sql?raw";
import { PlanningService } from "./service";
import type { RoleResult } from "../../runtime/types";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
});
const definition = {
  purpose: "独立解释 Agent 架构",
  scope_in: ["决策", "工具调用"],
  scope_out: ["训练大模型"],
  skills: ["concept"],
  first_draft_milestone: { suggested_days: 2, description: "画出第一版架构图" },
};
async function fixture(content: Record<string, unknown>) {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID();
  const p = await repo.create(owner, {
    client_operation_id: crypto.randomUUID(),
    name: "Agent",
    goal_text: "两周理解 Agent 架构",
    time_constraint_text: "2026-10-28 前完成",
    timezone: "Asia/Shanghai",
  });
  const command = {
    client_operation_id: crypto.randomUUID(),
    expected_revision: 0,
    command: {
      type: "send_message" as const,
      mode: "message" as const,
      text: "我觉得 Agent 就是会调工具的聊天，别的还说不清",
    },
  };
  const accepted = await repo.acceptCommand(
    { owner_id: owner, project_id: p.id },
    command,
  );
  const message = (await repo.readWorkspace(p.id)).messages[0];
  let calls = 0;
  const service = new PlanningService(repo, async () => {
    calls++;
    return {
      kind: "scope",
      content,
      evidence_ids: [message.id],
      usage: null,
    } as RoleResult;
  });
  const ctx = {
    owner_id: owner,
    project_id: p.id,
    operation_id: command.client_operation_id,
    step_key: "scope",
    base_revision: 1,
    epoch: 0,
    actor: "planner" as const,
    run_id: accepted.run_id,
  };
  return { repo, owner, p, service, ctx, message, calls: () => calls };
}
describe("planner learning outputs", () => {
  it("forms a scoped definition from sufficient information without another question", async () => {
    const { service, ctx, repo, p } = await fixture({
      kind: "definition",
      definition,
    });
    const result = await service.scope(ctx, {
      message_id: (await repo.readWorkspace(p.id)).messages[0].id,
    });
    expect(result.kind).toBe("definition");
    const saved = (await repo.readWorkspace(p.id)).artifacts.find(
      (a) => a.kind === "definition",
    );
    expect(
      JSON.parse(saved!.content).first_draft_milestone.suggested_days,
    ).toBe(2);
    expect(
      (await repo.getProject(ctx.owner_id, p.id)).time_constraint_text,
    ).toBe("2026-10-28 前完成");
  });
  it("does not ask a fourth clarification question after restart", async () => {
    const { service, ctx, repo, p, message } = await fixture({
      kind: "question",
      question: "这次学习要做成什么？",
      missing_fields: ["deliverable"],
    });
    await db
      .prepare("UPDATE projects SET scope_questions=3 WHERE id=?")
      .bind(p.id)
      .run();
    const result = await service.scope(ctx, { message_id: message.id });
    expect(result.kind).toBe("missing_fields");
    expect((await repo.getProject(ctx.owner_id, p.id)).scope_questions).toBe(3);
    expect(
      (await repo.readWorkspace(p.id)).messages
        .filter((m) => m.sender_role === "planner")
        .some((m) => m.body.includes("这次学习要做成什么")),
    ).toBe(false);
  });
  it("saves baseline understanding directly from the original message", async () => {
    const { service, ctx, repo, p, message } = await fixture({
      kind: "definition",
      definition,
    });
    await service.saveDiagnosis(ctx, message.id);
    const saved = (await repo.readWorkspace(p.id)).artifacts.find(
      (a) => a.kind === "diagnosis",
    );
    expect(saved?.content).toBe(
      "我觉得 Agent 就是会调工具的聊天，别的还说不清",
    );
    expect(JSON.parse(saved!.evidence_message_ids)).toEqual([message.id]);
  });
  it("keeps time settings unset and task cards contain three time blocks", async () => {
    const { service, ctx, repo, p, message } = await fixture({
      kind: "definition",
      definition,
    });
    const scope = await service.scope(ctx, { message_id: message.id });
    const current = await repo.getProject(ctx.owner_id, p.id);
    await repo.commitStep(
      { ...ctx, step_key: "fixture_source", base_revision: current.revision },
      {
        entities: [
          {
            table: "sources",
            row: {
              id: "source",
              reference_no: "M01",
              layer: "core",
              title: "架构",
              url: "https://example.org/agent",
              fetched_at: "2026-10-14T00:00:00Z",
              status: "accessible",
              verification_status: "pending",
            },
          },
        ],
      },
    );
    const planService = new PlanningService(repo, async (task) => ({
      kind: "plan",
      content:
        task.action === "plan"
          ? {
              milestones: ["画出架构"],
              tasks: [
                {
                  goal: "区分决策和工具",
                  skill_id: "concept",
                  material_ids: ["source"],
                  output: "三句话解释",
                },
              ],
            }
          : {
              goal: "区分决策和工具",
              material_ids: ["source"],
              output: "三句话解释",
              blocks: [
                { kind: "deep", activity: "读原文" },
                { kind: "supplement", activity: "看案例" },
                { kind: "reflection", activity: "合上资料重讲" },
              ],
            },
      evidence_ids: [],
      usage: null,
    }));
    const plan = await planService.createPlan(
      { ...ctx, step_key: "plan" },
      {
        definition_id: scope.artifact!.id,
        source_ids: ["source"],
        review_ids: [],
      },
    );
    const card = await planService.createTaskCard(
      { ...ctx, step_key: "task_card" },
      "2026-10-14",
    );
    const w = await repo.readWorkspace(p.id);
    expect(
      JSON.parse(w.artifacts.find((a) => a.id === plan.id)!.content)
        .time_setting,
    ).toBeNull();
    expect(
      JSON.parse(w.artifacts.find((a) => a.id === card.id)!.content).blocks.map(
        (b: { kind: string }) => b.kind,
      ),
    ).toEqual(["deep", "supplement", "reflection"]);
  });
});
