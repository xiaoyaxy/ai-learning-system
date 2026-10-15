import { describe, it, expect } from "vitest";
import { evaluateGoalImpact } from "./goal-impact";
const constraints = [
  { kind: "deadline" as const, raw_text: "2026-10-28", value: "2026-10-28" },
];
describe("explicit goal impact", () => {
  it("detects a delay without changing constraints", () => {
    expect(
      evaluateGoalImpact(constraints, {
        estimated_finish: "2026-10-29",
        estimate_basis: "新增练习需要一天",
        potentially_delays: true,
        scope_changed: false,
        time_commitment_changed: false,
        reorder_only: false,
      }).impact,
    ).toBe("affected");
    expect(constraints[0].value).toBe("2026-10-28");
  });
  it("asks when estimates are unknown", () => {
    expect(
      evaluateGoalImpact(constraints, {
        estimated_finish: null,
        estimate_basis: "",
        potentially_delays: true,
        scope_changed: false,
        time_commitment_changed: false,
        reorder_only: false,
      }).impact,
    ).toBe("unknown");
  });
  it("allows a pure reorder with no changed promises", () => {
    expect(
      evaluateGoalImpact(constraints, {
        estimated_finish: null,
        estimate_basis: "",
        potentially_delays: false,
        scope_changed: false,
        time_commitment_changed: false,
        reorder_only: true,
      }).impact,
    ).toBe("none");
  });
  it("does not let a model label scope or commitment changes safe", () => {
    expect(
      evaluateGoalImpact([], {
        estimated_finish: null,
        estimate_basis: "",
        potentially_delays: false,
        scope_changed: true,
        time_commitment_changed: false,
        reorder_only: true,
      }).impact,
    ).toBe("affected");
  });
});
