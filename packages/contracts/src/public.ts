import { z } from "zod";
import { RoleSchema, type Role } from "./commands";
export type RunStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "waiting_dependency"
  | "waiting_decision"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";
export type Phase =
  | "scoping"
  | "diagnosis"
  | "preparing"
  | "learning"
  | "practicing"
  | "reviewing"
  | "completion_check"
  | "completed";
export type GoalImpact = "none" | "affected" | "unknown";
export type CompletionStatus =
  | "policy_required"
  | "in_progress"
  | "pending_review"
  | "not_met"
  | "met"
  | "stale";
export const PublicEventSchema = z
  .object({
    project_id: z.string(),
    seq: z.number().int(),
    type: z.enum([
      "message_committed",
      "task_assigned",
      "role_status_changed",
      "handoff_committed",
      "artifact_committed",
      "plan_proposed",
      "decision_required",
      "plan_activated",
      "question_presented",
      "feedback_committed",
      "completion_changed",
      "run_failed",
    ]),
    run_id: z.string().nullable(),
    role: RoleSchema.nullable(),
    occurred_at: z.string(),
    payload: z
      .object({
        text: z.string().optional(),
        entity_id: z.string().optional(),
        status: z.string().optional(),
        from: RoleSchema.optional(),
        to: RoleSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type PublicEvent = z.infer<typeof PublicEventSchema>;
export interface PublicMessage {
  command_type?: string;
  id: string;
  seq: number;
  role: Role | "user" | "system";
  text: string;
  created_at: string;
}
export interface PublicArtifactDTO {
  id: string;
  kind: string;
  version: number;
  content: string;
  created_at: string;
}
export interface PublicQuestion {
  id: string;
  version: number;
  prompt: string;
  attempt_index: number;
}
export interface PendingInput {
  kind: "scope" | "diagnosis" | "answer" | "decision" | "weekly_review";
  entity_id: string;
  version: number;
  expected_role: Role;
}
export interface CompletionEvidenceDTO {
  status: CompletionStatus;
  correct_count: number | null;
  total_count: number | null;
  policy_version: number | null;
  goal_version: number;
  items: {
    question_id: string;
    attempt_id: string | null;
    verdict: string | null;
  }[];
}
export interface WorkspaceDTO {
  project: {
    id: string;
    name: string;
    goal_text: string;
    time_constraint_text: string;
    timezone: string;
    goal_version: number;
  };
  phase: Phase;
  revision: number;
  run_epoch: number;
  pending_input: PendingInput | null;
  active_run: {
    id: string;
    status: RunStatus;
    error_code: string | null;
  } | null;
  question: PublicQuestion | null;
  messages: PublicMessage[];
  artifacts: PublicArtifactDTO[];
  latest_seq: number;
  completion: CompletionEvidenceDTO;
  proposal: {
    id: string;
    version: number;
    impact: GoalImpact;
    summary: string;
    status: string;
  } | null;
  policy: {
    id: string;
    version: number;
    status: string;
    summary: string;
  } | null;
}
export interface EventPageDTO {
  events: PublicEvent[];
  next_seq: number;
  has_more: boolean;
}
export interface ErrorDTO {
  code: string;
  message: string;
  retryable: boolean;
  current_revision?: number;
  entity_id?: string;
}
