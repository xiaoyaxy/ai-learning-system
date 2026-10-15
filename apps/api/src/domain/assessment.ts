import type { CompletionEvidenceDTO } from "@learning/contracts";
import type {
  AssessmentPolicy,
  CompletionEvidenceInput,
} from "../features/assessment/types";
export function computeCompletion(
  policy: AssessmentPolicy | null,
  e: CompletionEvidenceInput,
): CompletionEvidenceDTO {
  const base: CompletionEvidenceDTO = {
    status: "policy_required",
    correct_count: null,
    total_count: null,
    policy_version: policy?.version ?? null,
    goal_version: e.goal_version,
    items: [],
  };
  if (!policy || policy.status !== "confirmed" || !policy.confirmed_message_id)
    return base;
  if (policy.goal_version !== e.goal_version)
    return { ...base, status: "stale" };
  const ids =
    policy.aggregation === "multi_session"
      ? policy.session_selection
      : e.active_session_id
        ? [e.active_session_id]
        : [];
  const total = policy.question_count * ids.length;
  if (!ids.length || !Number.isSafeInteger(total) || total <= 0)
    return { ...base, status: "in_progress" };
  let correct = 0,
    missing = false,
    uncertain = false,
    invalid = false;
  const items: CompletionEvidenceDTO["items"] = [];
  const covered = new Set<string>();
  for (const id of ids) {
    const session = e.sessions.find((s) => s.id === id);
    if (!session) {
      missing = true;
      continue;
    }
    if (
      session.goal_version !== e.goal_version ||
      session.policy_version !== policy.version ||
      session.purpose !== "completion"
    )
      return { ...base, status: "stale" };
    if (
      session.question_ids.length !== policy.question_count ||
      new Set(session.question_ids).size !== session.question_ids.length
    )
      invalid = true;
    for (const qid of session.question_ids) {
      const q = e.questions.find((x) => x.id === qid && x.session_id === id);
      if (!q) {
        missing = true;
        items.push({ question_id: qid, attempt_id: null, verdict: null });
        continue;
      }
      covered.add(q.skill_id);
      if (!policy.required_skill_ids.includes(q.skill_id)) invalid = true;
      const attempts = [...q.attempts].sort((a, b) => a.index - b.index),
        selected =
          policy.attempt_basis === "first"
            ? attempts.find((a) => a.index === 1)
            : attempts.at(-1);
      if (!selected) {
        missing = true;
        items.push({ question_id: qid, attempt_id: null, verdict: null });
        continue;
      }
      items.push({
        question_id: qid,
        attempt_id: selected.id,
        verdict: selected.verdict,
      });
      if (
        policy.attempt_basis === "after_correction" &&
        selected.index === 1 &&
        ["incorrect", "partial"].includes(selected.verdict ?? "")
      )
        missing = true;
      if (!selected.verdict || selected.verdict === "needs_review")
        uncertain = true;
      else if (
        selected.verdict === "correct" ||
        (selected.verdict === "partial" &&
          policy.partial_rule === "count_correct")
      )
        correct++;
    }
  }
  if (!missing && policy.required_skill_ids.some((s) => !covered.has(s)))
    invalid = true;
  const status =
    invalid || uncertain
      ? "pending_review"
      : missing
        ? "in_progress"
        : correct * 100 >= total * 80
          ? "met"
          : "not_met";
  return { ...base, status, correct_count: correct, total_count: total, items };
}
