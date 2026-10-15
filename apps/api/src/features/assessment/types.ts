export type Verdict = "correct" | "incorrect" | "partial" | "needs_review";
export interface AssessmentPolicy {
  id: string;
  version: number;
  status: "draft" | "confirmed";
  goal_version: number;
  question_count: number;
  required_skill_ids: string[];
  rubric: { correct_criteria: string[]; uncertain_rule: "needs_review" };
  partial_rule: "count_correct" | "count_incorrect";
  attempt_basis: "first" | "after_correction";
  aggregation: "single_session" | "multi_session";
  session_selection: string[];
  confirmed_message_id: string | null;
}
export interface EvidenceQuestion {
  id: string;
  session_id: string;
  skill_id: string;
  attempts: { id: string; index: number; verdict: Verdict | null }[];
}
export interface CompletionEvidenceInput {
  goal_version: number;
  active_session_id: string | null;
  sessions: {
    id: string;
    purpose: "practice" | "completion" | "diagnostic";
    goal_version: number;
    policy_version: number | null;
    question_ids: string[];
  }[];
  questions: EvidenceQuestion[];
}
