import { describe, it, expect } from "vitest";
import { computeCompletion } from "./assessment";
import type {
  AssessmentPolicy,
  CompletionEvidenceInput,
} from "../features/assessment/types";
const policy: AssessmentPolicy = {
  id: "p",
  version: 1,
  status: "confirmed",
  goal_version: 1,
  question_count: 5,
  required_skill_ids: ["concept"],
  rubric: {
    correct_criteria: ["说明关键概念"],
    uncertain_rule: "needs_review",
  },
  partial_rule: "count_incorrect",
  attempt_basis: "first",
  aggregation: "single_session",
  session_selection: [],
  confirmed_message_id: "user-confirmation",
};
function evidence(correct: number, n = 5): CompletionEvidenceInput {
  return {
    goal_version: 1,
    active_session_id: "s",
    sessions: [
      {
        id: "s",
        purpose: "completion",
        goal_version: 1,
        policy_version: 1,
        question_ids: Array.from({ length: n }, (_, i) => "q" + i),
      },
    ],
    questions: Array.from({ length: n }, (_, i) => ({
      id: "q" + i,
      session_id: "s",
      skill_id: "concept",
      attempts: [
        {
          id: "a" + i,
          index: 1,
          verdict: i < correct ? "correct" : "incorrect",
        },
      ],
    })),
  };
}
describe("completion evidence", () => {
  it("requires an explicitly confirmed policy", () => {
    expect(computeCompletion(null, evidence(5)).status).toBe("policy_required");
    expect(
      computeCompletion({ ...policy, status: "draft" }, evidence(5)).status,
    ).toBe("policy_required");
  });
  it("uses the full denominator and an exact 80 percent comparison", () => {
    expect(computeCompletion(policy, evidence(4))).toMatchObject({
      status: "met",
      correct_count: 4,
      total_count: 5,
    });
    expect(computeCompletion(policy, evidence(3)).status).toBe("not_met");
    expect(
      computeCompletion({ ...policy, question_count: 500 }, evidence(399, 500))
        .status,
    ).toBe("not_met");
  });
  it("does not complete a partial or uncertain assessment", () => {
    const missing = evidence(4);
    missing.questions.pop();
    expect(computeCompletion(policy, missing).status).toBe("in_progress");
    const uncertain = evidence(5);
    uncertain.questions[4].attempts[0].verdict = "needs_review";
    expect(computeCompletion(policy, uncertain).status).toBe("pending_review");
  });
  it("does not mix goal versions, practice or incomplete coverage", () => {
    const old = evidence(5);
    old.goal_version = 2;
    expect(computeCompletion(policy, old).status).toBe("stale");
    const practice = evidence(5);
    practice.sessions[0].purpose = "practice";
    expect(computeCompletion(policy, practice).status).not.toBe("met");
    expect(
      computeCompletion(
        { ...policy, required_skill_ids: ["other"] },
        evidence(5),
      ).status,
    ).toBe("pending_review");
  });
  it("counts corrected answers only when the confirmed policy selects them", () => {
    const corrected = evidence(3);
    corrected.questions[3].attempts.push({
      id: "second",
      index: 2,
      verdict: "correct",
    });
    expect(computeCompletion(policy, corrected).status).toBe("not_met");
    expect(
      computeCompletion(
        { ...policy, attempt_basis: "after_correction" },
        corrected,
      ).status,
    ).toBe("met");
  });
  it("maps partial answers explicitly and never silently gives half credit", () => {
    const partial = evidence(3);
    partial.questions[3].attempts[0].verdict = "partial";
    expect(computeCompletion(policy, partial).status).toBe("not_met");
    expect(
      computeCompletion({ ...policy, partial_rule: "count_correct" }, partial)
        .status,
    ).toBe("met");
  });
  it("aggregates only explicitly selected complete sessions", () => {
    const first = evidence(4),
      second = evidence(4);
    second.sessions[0].id = "s2";
    second.sessions[0].question_ids = second.sessions[0].question_ids.map(
      (x) => x + "b",
    );
    second.questions.forEach((q) => {
      q.id += "b";
      q.session_id = "s2";
    });
    const all = {
      ...first,
      sessions: [...first.sessions, ...second.sessions],
      questions: [...first.questions, ...second.questions],
    };
    expect(
      computeCompletion(
        {
          ...policy,
          aggregation: "multi_session",
          session_selection: ["s", "s2"],
        },
        all,
      ),
    ).toMatchObject({ status: "met", correct_count: 8, total_count: 10 });
  });
});
