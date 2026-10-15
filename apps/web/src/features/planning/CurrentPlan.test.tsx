import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CurrentPlan } from "./CurrentPlan";
import { fixture } from "../learning/materials.fixture";
import userEvent from "@testing-library/user-event";
import type { WorkspaceDTO } from "@learning/contracts";
afterEach(cleanup);
it("shows a compact saved plan with links and opens its full content separately", async () => {
  const view = vi.fn();
  render(<CurrentPlan workspace={fixture} onView={view} />);
  expect(screen.getByText("规划师已生成学习计划 · v1")).toBeTruthy();
  expect(screen.getByText("共 1 节课程")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /Agent官方文档/ }).getAttribute("href"),
  ).toBe("https://docs.example.com/agent");
  expect(screen.queryByText("Agent由模型、工具与状态循环组成。")).toBeNull();
  expect(screen.queryByText("可运行代码")).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "查看完整学习计划" }));
  expect(view).toHaveBeenCalledWith(expect.objectContaining({ id: "plan1" }));
});
