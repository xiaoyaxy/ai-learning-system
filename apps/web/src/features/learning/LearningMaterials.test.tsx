import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fixture } from "./materials.fixture";
import { LearningContent, ResourceOverview } from "./LearningMaterials";
afterEach(cleanup);
it("shows collected materials, knowledge points and the actual course outline", async () => {
  const open = vi.fn();
  render(<ResourceOverview workspace={fixture} onCourse={open} />);
  expect(screen.getByText("收集 1 份材料")).toBeTruthy();
  expect(screen.getByText("整理 1 个知识点")).toBeTruthy();
  expect(screen.getByText("安排 1 节课程")).toBeTruthy();
  await userEvent.setup().click(screen.getByText(/第1课/));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ goal: "构建工具调用" }),
  );
});
it("today learning contains knowledge explanations, source snippets and clickable real links", () => {
  render(
    <LearningContent
      workspace={fixture}
      lesson={{
        goal: "学习工具调用",
        material_ids: ["s1"],
        blocks: [{ kind: "deep", activity: "完成受约束的工具接口" }],
        output: "可运行代码",
      }}
    />,
  );
  expect(screen.getByText("使用受约束的函数与外部系统交互。")).toBeTruthy();
  expect(screen.getByText("Agent由模型、工具与状态循环组成。")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /Agent官方文档/ }).getAttribute("href"),
  ).toBe("https://docs.example.com/agent");
});
it("displays Beijing while preserving the standard timezone identifier", async () => {
  const { displayTimezone } = await import("./LearningMaterials");
  expect(displayTimezone("Asia/Shanghai")).toBe("Asia/Beijing");
  expect(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date("2026-10-14T00:00:00Z")),
  ).toBe("08");
});

it("keeps today's chat card short with source links and a separate full-content action", async () => {
  const open = vi.fn();
  render(
    <LearningContent
      compact
      onOpen={open}
      workspace={fixture}
      lesson={{
        goal: "学习工具调用",
        material_ids: ["s1"],
        blocks: [{ kind: "deep", activity: "完成受约束的工具接口" }],
        output: "可运行代码",
      }}
    />,
  );
  expect(screen.getByText("学习工具调用")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Agent官方文档/ })).toBeTruthy();
  for (const text of [
    "使用受约束的函数与外部系统交互。",
    "Agent由模型、工具与状态循环组成。",
    "完成受约束的工具接口",
    "你的产出：可运行代码",
  ]) {
    expect(screen.queryByText(text)).toBeNull();
  }
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "查看今日学习内容" }));
  expect(open).toHaveBeenCalledOnce();
});
