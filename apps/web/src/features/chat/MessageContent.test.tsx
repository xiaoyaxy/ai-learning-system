import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageContent } from "../../App";
import { fixture } from "../learning/materials.fixture";
afterEach(cleanup);
it("keeps a historical task card source context when opening its full content", async () => {
  const text = JSON.stringify({
    goal: "历史学习目标",
    goal_version: 0,
    material_ids: ["M01"],
    blocks: [{ kind: "deep", activity: "旧目标活动" }],
  });
  const workspace = {
      ...fixture,
      artifacts: [
        ...fixture.artifacts,
        {
          id: "old-card",
          kind: "task_card",
          version: 1,
          content: text,
          created_at: "2026-10-13T00:00:00Z",
        },
      ],
    },
    open = vi.fn();
  render(<MessageContent workspace={workspace} text={text} onLesson={open} />);
  expect(
    screen.getByRole("link", { name: /旧目标材料/ }).getAttribute("href"),
  ).toBe("https://docs.example.com/old");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "查看今日学习内容" }));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ artifact_id: "old-card", goal: "历史学习目标" }),
  );
});
