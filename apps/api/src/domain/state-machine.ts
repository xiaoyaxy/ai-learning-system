import type { Phase, ProjectCommand } from "@learning/contracts";
export interface LearningState {
  phase: Phase;
  pending_kind: string | null;
}
export function transition(
  state: LearningState,
  command: ProjectCommand,
): { allowed: boolean; code?: string; phase?: Phase; skipped?: boolean } {
  const control = [
    "pause_run",
    "resume_run",
    "retry_run",
    "cancel_run",
    "supplement_requirements",
  ];
  if (control.includes(command.type)) return { allowed: true };
  if (
    state.pending_kind === "start_learning" &&
    [
      "start_practice",
      "start_completion_check",
      "start_weekly_review",
    ].includes(command.type)
  )
    return { allowed: false, code: "INVALID_STAGE" };
  if (command.type === "request_stage_jump")
    return { allowed: true, phase: command.phase, skipped: true };
  if (
    state.pending_kind === "answer" &&
    command.type !== "reassess_answer" &&
    command.type !== "submit_answer" &&
    !(command.type === "send_message" && command.mode === "answer")
  )
    return { allowed: false, code: "ANSWER_PENDING" };
  if (
    command.type === "start_completion_check" &&
    ["scoping", "diagnosis", "preparing"].includes(state.phase)
  )
    return { allowed: false, code: "INVALID_STAGE" };
  if (command.type === "submit_answer" && state.pending_kind !== "answer")
    return { allowed: false, code: "INVALID_STAGE" };
  return { allowed: true };
}
