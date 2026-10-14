import React from "react";
import { afterEach, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PublicEvent } from "@learning/contracts";
import { HandoffFeed } from "./HandoffFeed";
const roles = {
  supervisor: { name: "学务总管" },
  planner: { name: "规划师" },
  curator: { name: "知识管家" },
  coach: { name: "陪练官" },
};
const event = (
  seq: number,
  run: string,
  text = "明确学习范围",
  to = "planner",
) =>
  ({
    project_id: "p",
    seq,
    run_id: run,
    type: "task_assigned",
    role: "supervisor",
    occurred_at: "2026-10-14T08:00:00Z",
    payload: { to, text },
  }) as PublicEvent;
afterEach(cleanup);
it("shows the current clarification round once instead of identical historical cards", () => {
  render(
    <HandoffFeed
      events={[event(1, "old"), event(3, "current")]}
      runId="current"
      roles={roles}
    />,
  );
  expect(screen.getAllByText("明确学习范围")).toHaveLength(1);
  expect(screen.getAllByText("学务总管 → 规划师")).toHaveLength(1);
});
it("collapses consecutive repeated steps but retains a later return to the same activity", () => {
  render(
    <HandoffFeed
      events={[
        event(1, "r", "核对资料内容", "curator"),
        event(2, "r", "核对资料内容", "curator"),
        event(3, "r", "整理资料与知识地图", "curator"),
        event(4, "r", "核对资料内容", "curator"),
      ]}
      runId="r"
      roles={roles}
    />,
  );
  expect(screen.getAllByText("核对资料内容")).toHaveLength(2);
  expect(screen.getAllByText("整理资料与知识地图")).toHaveLength(1);
});
it("does not show old collaboration when there is no current run", () => {
  const { container } = render(
    <HandoffFeed events={[event(1, "old")]} runId={null} roles={roles} />,
  );
  expect(container.querySelector(".handoff")).toBeNull();
});
