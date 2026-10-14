import { z } from "zod";
export const RoleSchema = z.enum(["supervisor", "planner", "curator", "coach"]);
export type Role = z.infer<typeof RoleSchema>;
const text = z
  .string()
  .min(1)
  .refine((x) => Array.from(x).length <= 12000, "正文最多 12,000 字符");
const id = z.string().min(1).max(128);
const typed = <T extends string>(type: T) =>
  z.object({ type: z.literal(type) }).strict();
export const ProjectCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("send_message"),
      text,
      target_role: RoleSchema.optional(),
      mode: z.enum(["message", "answer"]),
    })
    .strict(),
  z.object({ type: z.literal("submit_diagnosis"), text }).strict(),
  typed("start_learning"),
  typed("start_practice"),
  typed("start_completion_check"),
  z
    .object({
      type: z.literal("revise_assessment_policy"),
      policy_id: id,
      policy_version: z.number().int().positive(),
      text,
    })
    .strict(),
  typed("start_weekly_review"),
  z.object({ type: z.literal("record_learning"), text }).strict(),
  z
    .object({
      type: z.literal("save_note"),
      text,
      base_note: z
        .object({ id, version: z.number().int().positive() })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_note"),
      note_id: id,
      note_version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ type: z.literal("complete_review"), review_id: id, text })
    .strict(),
  z.object({ type: z.literal("reassess_answer"), attempt_id: id }).strict(),
  z
    .object({
      type: z.literal("submit_answer"),
      question_id: id,
      question_version: z.number().int().positive(),
      attempt_index: z.number().int().min(1).max(2),
      text,
    })
    .strict(),
  z
    .object({
      type: z.literal("decide_proposal"),
      proposal_id: id,
      proposal_version: z.number().int().positive(),
      decision: z.enum(["accept", "retain", "pause"]),
    })
    .strict(),
  z.object({ type: z.literal("submit_draft"), text }).strict(),
  z.object({ type: z.literal("submit_final"), text }).strict(),
  z
    .object({
      type: z.literal("confirm_assessment_policy"),
      policy_id: id,
      policy_version: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("pause_run"), run_id: id }).strict(),
  z.object({ type: z.literal("resume_run"), run_id: id }).strict(),
  z.object({ type: z.literal("retry_run"), run_id: id }).strict(),
  z.object({ type: z.literal("cancel_run"), run_id: id }).strict(),
  z.object({ type: z.literal("supplement_requirements"), text }).strict(),
  z
    .object({
      type: z.literal("request_stage_jump"),
      phase: z.enum([
        "scoping",
        "diagnosis",
        "preparing",
        "learning",
        "practicing",
        "reviewing",
        "completion_check",
      ]),
    })
    .strict(),
]);
export const CommandEnvelopeSchema = z
  .object({
    client_operation_id: z.uuid(),
    expected_revision: z.number().int().nonnegative(),
    command: ProjectCommandSchema,
  })
  .strict();
export const CreateProjectSchema = z
  .object({
    client_operation_id: z.uuid(),
    name: z.string().min(1).max(100),
    goal_text: text,
    time_constraint_text: z.string().max(12000),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "无效时区"),
  })
  .strict();
export type ProjectCommand = z.infer<typeof ProjectCommandSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export interface AcceptedCommand {
  run_id: string;
  revision: number;
  replayed: boolean;
}

export interface MentionResult {
  ok: boolean;
  role?: Role;
  text: string;
  body: string;
  code?: "AMBIGUOUS_MENTION";
}
export function parseMention(text: string, selectedRole?: Role): MentionResult {
  const aliases: Record<string, Role> = {
    学务总管: "supervisor",
    总管: "supervisor",
    规划师: "planner",
    知识管家: "curator",
    陪练官: "coach",
    supervisor: "supervisor",
    planner: "planner",
    curator: "curator",
    coach: "coach",
  };
  const pattern =
    /^[@＠](学务总管|总管|规划师|知识管家|陪练官|supervisor|planner|curator|coach)(?:\s+|$)/i;
  const trimmed = text.trimStart(),
    match = pattern.exec(trimmed),
    role = match ? aliases[match[1].toLowerCase()] : undefined,
    body = match ? trimmed.slice(match[0].length) : text;
  if (
    (role && selectedRole && role !== selectedRole) ||
    pattern.test(body.trimStart())
  )
    return { ok: false, text, body, code: "AMBIGUOUS_MENTION" };
  return { ok: true, role: role ?? selectedRole, text, body };
}
