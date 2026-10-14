import React from "react";
import { afterEach, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CurrentPlan } from "./CurrentPlan";
import type { WorkspaceDTO } from "@learning/contracts";
afterEach(cleanup);
it("shows the saved plan in chat even for an existing project without a plan message", () => {
  const workspace = {
    phase: "learning",
    project: { goal_version: 1 },
    artifacts: [
      {
        id: "p",
        kind: "plan",
        version: 1,
        content: JSON.stringify({
          milestones: ["完成可运行Agent"],
          tasks: [
            {
              goal: "实现工具调用",
              skill_id: "tools",
              output: "一个可运行工具",
              material_ids: [],
            },
          ],
          time_constraint_text: "两周内",
        }),
        created_at: "2026-10-14T00:00:00Z",
      },
    ],
  } as unknown as WorkspaceDTO;
  render(<CurrentPlan workspace={workspace} />);
  expect(screen.getByText("规划师已生成学习计划 · v1")).toBeTruthy();
  expect(screen.getByText("完成可运行Agent")).toBeTruthy();
  expect(screen.getByText("1. 实现工具调用")).toBeTruthy();
  expect(screen.getByText("时间约束：两周内")).toBeTruthy();
});
