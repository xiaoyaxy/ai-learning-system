import { it, expect } from "vitest";
import type { WorkspaceDTO } from "@learning/contracts";
import { getLearningData, resolveMaterials } from "./materials";
import { fixture } from "./materials.fixture";

it("counts current-goal materials and lessons from the active plan", () => {
  const data = getLearningData(fixture);
  expect(data.materials).toHaveLength(1);
  expect(data.courses[0].goal).toBe("构建工具调用");
  expect(data.concepts).toHaveLength(1);
});
it("resolves real IDs or reference numbers without inventing missing links", () => {
  expect(resolveMaterials(["s1", "M01", "missing"], fixture)).toHaveLength(1);
  expect(resolveMaterials(["missing"], fixture)).toHaveLength(0);
});
it("supports existing maps while rejecting unsafe URLs", () => {
  const w = {
    ...fixture,
    materials: undefined,
    artifacts: [
      {
        ...fixture.artifacts[0],
        content: JSON.stringify({
          source_catalog: [
            { id: "s1", url: "https://docs.example.com/agent" },
            { id: "bad", url: "javascript:alert(1)" },
          ],
        }),
      },
    ],
  };
  expect(getLearningData(w).materials).toHaveLength(1);
});
it("ignores task cards from an older goal or plan when opening today", async () => {
  const { currentTaskCard } = await import("./materials");
  const w = {
    ...fixture,
    artifacts: [
      ...fixture.artifacts,
      {
        id: "old-card",
        kind: "task_card",
        version: 2,
        content: JSON.stringify({
          goal: "旧今日计划",
          goal_version: 0,
          material_ids: ["old"],
        }),
      },
      {
        id: "card",
        kind: "task_card",
        version: 1,
        content: JSON.stringify({
          goal: "当前今日计划",
          goal_version: 1,
          plan_id: "plan1",
          material_ids: ["s1"],
        }),
      },
    ],
  } as WorkspaceDTO;
  expect(currentTaskCard(w)?.lesson.goal).toBe("当前今日计划");
});
it("resolves historical sources without adding them to current-goal statistics", () => {
  expect(getLearningData(fixture).materials).toHaveLength(1);
  expect(resolveMaterials(["old"], fixture)[0]?.url).toBe(
    "https://docs.example.com/old",
  );
  expect(resolveMaterials(["M01"], fixture, { goal_version: 0 })[0]?.id).toBe(
    "old",
  );
});
it("does not reuse ambiguous legacy daily cards under the current plan", async () => {
  const { currentTaskCard } = await import("./materials");
  const w = {
    ...fixture,
    artifacts: [
      ...fixture.artifacts,
      {
        id: "legacy-card",
        kind: "task_card",
        version: 1,
        content: JSON.stringify({
          goal: "旧计划课程",
          material_ids: ["s1"],
          date: "2026-10-14",
        }),
      },
    ],
  } as WorkspaceDTO;
  expect(currentTaskCard(w)).toBe(null);
});
