import { describe, it, expect } from "vitest";
import { authorizeTool } from "./permissions";
const ctx = {
  owner_id: "owner",
  project_id: "p",
  operation_id: "o",
  step_key: "s",
  base_revision: 0,
  epoch: 0,
  actor: "coach" as const,
  run_id: "r",
};
describe("role tools", () => {
  it("separates grading from plan changes", () => {
    expect(() => authorizeTool(ctx, { type: "activate_plan" })).toThrow(
      "FORBIDDEN",
    );
    expect(() =>
      authorizeTool({ ...ctx, actor: "planner" }, { type: "activate_plan" }),
    ).not.toThrow();
  });
  it("allows only curator to modify notes", () => {
    expect(() =>
      authorizeTool(
        { ...ctx, actor: "planner" },
        { type: "write_artifact", kind: "note" },
      ),
    ).toThrow("FORBIDDEN");
    expect(() =>
      authorizeTool(
        { ...ctx, actor: "curator" },
        { type: "write_artifact", kind: "note" },
      ),
    ).not.toThrow();
  });
  it("does not let the supervisor write learning content", () => {
    expect(() =>
      authorizeTool(
        { ...ctx, actor: "supervisor" },
        { type: "write_artifact", kind: "learning_card" },
      ),
    ).toThrow("FORBIDDEN");
  });
});
