import {
  PublicEventSchema,
  type WorkspaceDTO,
  type PublicEvent,
  type CompletionEvidenceDTO,
  type PendingInput,
} from "@learning/contracts";
import { publicHttpsUrl } from "../providers/source-reader";
import type { WorkspaceRecord, EventRecord } from "../db/types";
export const publicTimestamp = (s: string) =>
  s.includes("T") ? s : s.replace(" ", "T") + "Z";
const decode = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
export function toWorkspaceDTO(r: WorkspaceRecord): WorkspaceDTO {
  const p = r.project;
  const pending = decode<PendingInput | null>(p.pending_input_json, null);
  const question =
    pending?.kind === "answer"
      ? r.questions.find((q) => q.id === pending.entity_id)
      : null;
  const run = r.runs.find((x) => x.id === p.active_run_id);
  const proposal = [...r.proposals]
    .reverse()
    .find((x) => ["pending", "paused"].includes(String(x.status)));
  const policy = r.policies.at(-1);
  const attempts = r.attempts.filter((a) => a.question_id === question?.id);
  const evaluation = r.evaluations
    .filter((e) => e.attempt_id === attempts.at(-1)?.id)
    .at(-1);
  const canAnswer = attempts.length === 0 || !!evaluation?.followup;
  const reflection =
    pending?.kind === "weekly_review"
      ? r.questions.find((q) => q.id === pending.entity_id)
      : null;
  const reflectionSession = r.sessions.find(
    (s) => s.id === reflection?.session_id,
  );
  const reflectionIds = reflectionSession
    ? decode<string[]>(String(reflectionSession.question_ids_json), [])
    : [];
  return {
    materials: r.sources
      .filter((s) => publicHttpsUrl(String(s.url ?? "")))
      .map((s) => ({
        id: String(s.id),
        reference_no: String(s.reference_no ?? ""),
        title: String(s.title ?? "学习材料"),
        url: String(s.url),
        summary: String(s.summary ?? "").slice(0, 2000),
        layer: String(s.layer ?? ""),
        goal_version: Number(s.goal_version ?? 1),
        verification_status: String(s.verification_status ?? "pending"),
      })),
    project: {
      id: p.id,
      name: p.name,
      goal_text: p.goal_text,
      time_constraint_text: p.time_constraint_text,
      timezone: p.timezone,
      goal_version: p.goal_version,
      active_plan_id: p.active_plan_id,
    },
    phase: p.phase,
    revision: p.revision,
    run_epoch: p.run_epoch,
    pending_input: pending,
    weekly_review: reflection
      ? {
          id: String(reflection.id),
          version: Number(reflection.version),
          prompt: String(reflection.prompt),
          index: reflectionIds.indexOf(String(reflection.id)) + 1,
          total: reflectionIds.length,
        }
      : null,
    reviews: r.reviews.map((v) => ({
      id: String(v.id),
      skill_id: String(v.skill_id),
      goal_version: Number(v.goal_version ?? 1),
      due_date: String(v.due_date),
      form: String(v.form),
      status: String(v.status),
    })),
    assessments: r.questions
      .filter(
        (q) =>
          pending?.entity_id === q.id ||
          r.attempts.some((a) => a.question_id === q.id),
      )
      .map((q) => {
        const s = r.sessions.find((s) => s.id === q.session_id);
        return {
          question_id: String(q.id),
          prompt: String(q.prompt),
          session_id: String(q.session_id),
          purpose: String(s?.purpose ?? "unknown"),
          goal_version: Number(s?.goal_version ?? 0),
          attempts: r.attempts
            .filter((a) => a.question_id === q.id)
            .map((a) => ({
              id: String(a.id),
              index: Number(a.attempt_index),
              answer_message_id: String(a.answer_message_id),
              text: String(
                a.answer_text ??
                  r.messages.find((m) => m.id === a.answer_message_id)?.body ??
                  "",
              ),
              evaluations: r.evaluations
                .filter((e) => e.attempt_id === a.id)
                .map((e) => ({
                  id: String(e.id),
                  verdict: String(e.verdict),
                  feedback: String(e.feedback),
                  followup: e.followup == null ? null : String(e.followup),
                  reveal_allowed: !!e.reveal_allowed,
                  policy_version:
                    e.policy_version == null ? null : Number(e.policy_version),
                })),
            })),
        };
      }),
    active_run: run
      ? { id: run.id, status: run.status, error_code: run.error_code }
      : null,
    question:
      question && canAnswer
        ? {
            id: String(question.id),
            version: Number(question.version),
            prompt: String(evaluation?.followup ?? question.prompt),
            attempt_index:
              r.attempts.filter((a) => a.question_id === question.id).length +
              1,
          }
        : null,
    messages: r.messages.map((m) => ({
      ...(() => {
        try {
          const command = JSON.parse(
            r.runs.find((run) => run.id === m.run_id)?.command_json ?? "null",
          );
          return m.sender_role === "user" && command && !("text" in command)
            ? { command_type: String(command.type) }
            : {};
        } catch {
          return {};
        }
      })(),
      id: m.id,
      seq: m.seq,
      role: m.sender_role,
      text: m.body,
      created_at: publicTimestamp(m.created_at),
    })),
    artifacts: r.artifacts.map((a) => ({
      tombstone: !!a.tombstone,
      supersedes_id: a.supersedes_id,
      id: a.id,
      kind: a.kind,
      version: a.version,
      content: a.content,
      created_at: publicTimestamp(a.created_at),
    })),
    latest_seq: r.latest_seq,
    completion: decode<CompletionEvidenceDTO>(p.completion_json, {
      status: "policy_required",
      correct_count: null,
      total_count: null,
      policy_version: null,
      goal_version: p.goal_version,
      items: [],
    }),
    proposal: proposal
      ? {
          id: String(proposal.id),
          version: Number(proposal.version),
          impact: proposal.impact as "none" | "affected" | "unknown",
          summary: String(proposal.summary),
          status: String(proposal.status),
        }
      : null,
    policy: policy
      ? {
          id: String(policy.id),
          version: Number(policy.version),
          status: String(policy.status),
          summary: policySummary(String(policy.policy_json)),
        }
      : null,
  };
}
function policySummary(json: string) {
  const p = decode<Record<string, unknown>>(json, {});
  return JSON.stringify({ ...p, threshold_percent: 80 }, null, 2);
}
export function toPublicEvent(r: EventRecord): PublicEvent {
  const raw = decode<Record<string, unknown>>(r.payload_json, {});
  const payload = Object.fromEntries(
    ["text", "entity_id", "status", "from", "to"]
      .filter((k) => typeof raw[k] === "string")
      .map((k) => [k, raw[k]]),
  );
  return PublicEventSchema.parse({
    project_id: r.project_id,
    seq: r.seq,
    type: r.type,
    run_id: r.run_id,
    role: r.role,
    occurred_at: publicTimestamp(r.occurred_at),
    payload,
  });
}
