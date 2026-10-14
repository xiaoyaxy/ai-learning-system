import type { Role, Phase, RunStatus } from "@learning/contracts";
export type Actor = Role | "trusted_ingress" | "runtime";
export type ArtifactKind =
  | "definition"
  | "diagnosis"
  | "plan"
  | "task_card"
  | "knowledge_map"
  | "learning_card"
  | "note"
  | "draft"
  | "final"
  | "review_comments"
  | "weekly_report"
  | "index";
export interface ArtifactRef {
  project_id: string;
  id: string;
  kind: ArtifactKind;
  version: number;
}
export interface IngressContext {
  owner_id: string;
  project_id: string;
}
export interface StepContext extends IngressContext {
  operation_id: string;
  step_key: string;
  base_revision: number;
  epoch: number;
  actor: Actor;
}
export interface ProjectRecord {
  id: string;
  owner_id: string;
  name: string;
  goal_text: string;
  time_constraint_text: string;
  timezone: string;
  goal_version: number;
  revision: number;
  run_epoch: number;
  phase: Phase;
  active_run_id: string | null;
  active_plan_id: string | null;
  pending_input_json: string | null;
  completion_json: string | null;
  scope_questions: number;
  notification_mode: string;
  created_at: string;
}
export interface ArtifactRecord {
  project_id: string;
  id: string;
  kind: ArtifactKind;
  version: number;
  content: string;
  evidence_message_ids: string;
  created_by: Actor;
  supersedes_id: string | null;
  tombstone: number;
  created_at: string;
}
export interface MessageRecord {
  project_id: string;
  id: string;
  seq: number;
  sender_role: Role | "user" | "system";
  body: string;
  run_id: string | null;
  created_at: string;
}
export interface RunRecord {
  project_id: string;
  id: string;
  operation_id: string;
  epoch: number;
  status: RunStatus;
  command_json: string;
  error_code: string | null;
  budget_json: string;
  retry_count: number;
  created_at: string;
}
export interface EventRecord {
  project_id: string;
  seq: number;
  type: string;
  payload_json: string;
  run_id: string | null;
  role: Role | null;
  occurred_at: string;
}
export type EntityTable =
  | "messages"
  | "artifacts"
  | "sources"
  | "project_constraints"
  | "assessment_policies"
  | "assessment_sessions"
  | "quiz_questions"
  | "question_secrets"
  | "quiz_attempts"
  | "quiz_evaluations"
  | "review_schedule"
  | "plan_proposals"
  | "decisions"
  | "run_steps"
  | "provider_calls";
export type RowValue = string | number | null;
export interface EntityWrite {
  table: EntityTable;
  row: Record<string, RowValue>;
}
export interface StepWriteSet {
  entities?: EntityWrite[];
  events?: {
    type: string;
    payload: {
      text?: string;
      entity_id?: string;
      status?: string;
      from?: Role;
      to?: Role;
    };
    role?: Role;
    run_id?: string;
  }[];
  project_changes?: Partial<
    Pick<
      ProjectRecord,
      | "phase"
      | "active_run_id"
      | "active_plan_id"
      | "pending_input_json"
      | "completion_json"
      | "scope_questions"
      | "run_epoch"
      | "goal_version"
      | "goal_text"
      | "time_constraint_text"
    >
  >;
  run_changes?: {
    run_id: string;
    status?: RunStatus;
    error_code?: string | null;
    budget_json?: string;
    retry_count?: number;
    epoch?: number;
  };
  source_changes?: {
    id: string;
    status: string;
    summary?: string;
    fetched_at?: string;
    verification_status?: string;
  };
  provider_changes?: {
    id: string;
    status: string;
    result_json?: string | null;
    usage_json?: string | null;
  };
  result?: Record<string, RowValue>;
}
export interface StepReceipt {
  project_id: string;
  operation_id: string;
  step_key: string;
  epoch: number;
  revision: number;
  result: Record<string, RowValue>;
}
export interface WorkspaceRecord {
  project: ProjectRecord;
  messages: MessageRecord[];
  artifacts: ArtifactRecord[];
  runs: RunRecord[];
  questions: Record<string, RowValue>[];
  secrets: Record<string, RowValue>[];
  policies: Record<string, RowValue>[];
  proposals: Record<string, RowValue>[];
  sessions: Record<string, RowValue>[];
  attempts: Record<string, RowValue>[];
  evaluations: Record<string, RowValue>[];
  reviews: Record<string, RowValue>[];
  sources: Record<string, RowValue>[];
  latest_seq: number;
}
