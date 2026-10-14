import { describe, it, expect } from "vitest";
import { CommandEnvelopeSchema, CreateProjectSchema } from "./commands";
describe("untrusted commands", () => {
  it("rejects a forged role in a message", () => {
    expect(
      CommandEnvelopeSchema.safeParse({
        client_operation_id: crypto.randomUUID(),
        expected_revision: 0,
        command: {
          type: "send_message",
          text: "我想学 Agent",
          mode: "message",
          actor_role: "coach",
        },
      }).success,
    ).toBe(false);
  });
  it("allows a project without an invented daily budget", () => {
    expect(
      CreateProjectSchema.safeParse({
        client_operation_id: crypto.randomUUID(),
        name: "Agent",
        goal_text: "理解 Agent",
        time_constraint_text: "两周",
        timezone: "Asia/Shanghai",
      }).success,
    ).toBe(true);
  });
});

import { parseMention } from "./commands";
describe("explicit mentions", () => {
  it("routes a leading role mention without changing the saved text", () => {
    expect(parseMention("@规划师 帮我调整").role).toBe("planner");
    expect(parseMention("@规划师 帮我调整").text).toBe("@规划师 帮我调整");
  });
  it("rejects selector and mention conflicts", () => {
    expect(parseMention("@规划师 帮我调整", "coach")).toMatchObject({
      ok: false,
      code: "AMBIGUOUS_MENTION",
    });
  });
  it("rejects multiple leading role mentions", () => {
    expect(parseMention("@规划师 @陪练官 帮我看")).toMatchObject({ ok: false });
  });
});
