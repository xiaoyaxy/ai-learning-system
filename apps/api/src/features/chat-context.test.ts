import { it, expect } from "vitest";
import { buildChatContext } from "./chat-context";
import type { WorkspaceRecord } from "../db/types";
it("gives a role the actual goal, active plan and today task without private grading data", () => {
  const w = {
    project: {
      goal_text: "开发生产级agent",
      goal_version: 1,
      time_constraint_text: "两周内",
      phase: "learning",
      active_plan_id: "p1",
    },
    artifacts: [
      {
        id: "d",
        kind: "definition",
        version: 1,
        content: '{"goal_version":1,"purpose":"搭建Agent"}',
      },
      {
        id: "p1",
        kind: "plan",
        version: 1,
        content: '{"tasks":[{"goal":"实现工具调用"}]}',
      },
      {
        id: "t1",
        kind: "task_card",
        version: 1,
        content: '{"goal":"实现第一个工具"}',
      },
    ],
    messages: Array.from({ length: 10 }, (_, i) => ({
      sender_role: "user",
      body: "消息" + i,
    })),
    question_secrets: [{ reference_answer: "PRIVATE_CANARY" }],
  } as unknown as WorkspaceRecord;
  const value = buildChatContext(w);
  expect(value).toMatchObject({
    goal: "开发生产级agent",
    active_plan: { tasks: [{ goal: "实现工具调用" }] },
    today_task: { goal: "实现第一个工具" },
  });
  expect(JSON.stringify(value)).not.toContain("PRIVATE_CANARY");
  expect((value as any).recent_messages).toHaveLength(8);
});
