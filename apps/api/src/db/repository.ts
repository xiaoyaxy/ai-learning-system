import {
  CommandEnvelopeSchema,
  CreateProjectSchema,
  type AcceptedCommand,
  type CommandEnvelope,
  type CreateProjectInput,
} from "@learning/contracts";
import type {
  ProjectRecord,
  IngressContext,
  StepContext,
  StepWriteSet,
  StepReceipt,
  WorkspaceRecord,
  EventRecord,
  RowValue,
  EntityTable,
} from "./types";
export class RepositoryError extends Error {
  constructor(
    public code: string,
    public current_revision?: number,
  ) {
    super(code);
  }
}
export async function payloadHash(value: unknown) {
  const normalize = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(normalize)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, normalize(v)]),
          )
        : x;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(normalize(value))),
  );
  return Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
const columns: Record<EntityTable, string[]> = {
  messages: ["id", "seq", "sender_role", "body", "run_id", "created_at"],
  artifacts: [
    "id",
    "kind",
    "version",
    "content",
    "evidence_message_ids",
    "created_by",
    "supersedes_id",
    "tombstone",
    "created_at",
  ],
  sources: [
    "id",
    "goal_version",
    "reference_no",
    "layer",
    "title",
    "url",
    "fetched_at",
    "status",
    "verification_status",
    "summary",
    "citations_json",
    "created_at",
  ],
  project_constraints: [
    "id",
    "goal_version",
    "kind",
    "raw_text",
    "value_json",
    "created_at",
  ],
  assessment_policies: [
    "id",
    "version",
    "status",
    "policy_json",
    "confirmed_message_id",
    "created_at",
  ],
  assessment_sessions: [
    "id",
    "purpose",
    "policy_id",
    "policy_version",
    "goal_version",
    "status",
    "question_ids_json",
    "required_skills_json",
    "created_at",
  ],
  quiz_questions: [
    "id",
    "session_id",
    "version",
    "prompt",
    "skill_id",
    "kind",
    "created_at",
  ],
  question_secrets: [
    "question_id",
    "reference_answer",
    "rubric_json",
    "explanation",
  ],
  quiz_attempts: [
    "id",
    "question_id",
    "attempt_index",
    "answer_message_id",
    "created_at",
  ],
  quiz_evaluations: [
    "id",
    "attempt_id",
    "policy_version",
    "verdict",
    "gap",
    "feedback",
    "followup",
    "reveal_allowed",
    "supersedes_id",
    "created_at",
  ],
  review_schedule: [
    "id",
    "skill_id",
    "goal_version",
    "learned_date",
    "offset_days",
    "due_date",
    "form",
    "status",
    "evidence_id",
    "created_at",
  ],
  plan_proposals: [
    "id",
    "version",
    "base_plan_version",
    "base_goal_version",
    "changes_json",
    "impact",
    "summary",
    "status",
    "created_at",
  ],
  decisions: [
    "id",
    "proposal_id",
    "proposal_version",
    "decision",
    "message_id",
    "created_at",
  ],
  run_steps: [
    "id",
    "run_id",
    "step_key",
    "status",
    "result_json",
    "created_at",
  ],
  provider_calls: [
    "id",
    "run_id",
    "request_hash",
    "status",
    "result_json",
    "usage_json",
    "created_at",
  ],
};
const projectKeys = new Set([
  "phase",
  "active_run_id",
  "active_plan_id",
  "pending_input_json",
  "completion_json",
  "scope_questions",
  "run_epoch",
  "goal_version",
  "goal_text",
  "time_constraint_text",
]);
export class ProjectRepository {
  constructor(public readonly db: D1Database) {}
  async create(
    ownerId: string,
    raw: CreateProjectInput,
  ): Promise<ProjectRecord> {
    const input = CreateProjectSchema.parse(raw),
      hash = await payloadHash(input);
    const replay = async () => {
      const r = await this.db
        .prepare(
          "SELECT * FROM project_creation_receipts WHERE owner_id=? AND client_operation_id=?",
        )
        .bind(ownerId, input.client_operation_id)
        .first<{ payload_hash: string; project_id: string }>();
      if (!r) return null;
      if (r.payload_hash !== hash)
        throw new RepositoryError("IDEMPOTENCY_CONFLICT");
      return this.getProject(ownerId, r.project_id);
    };
    const prior = await replay();
    if (prior) return prior;
    const id = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO projects(id,owner_id,name,goal_text,time_constraint_text,timezone,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            ownerId,
            input.name,
            input.goal_text,
            input.time_constraint_text,
            input.timezone,
            new Date().toISOString(),
          ),
        this.db
          .prepare("INSERT INTO project_creation_receipts VALUES(?,?,?,?,?)")
          .bind(
            ownerId,
            input.client_operation_id,
            hash,
            id,
            JSON.stringify({ id }),
          ),
      ]);
    } catch (e) {
      const existing = await replay();
      if (existing) return existing;
      throw e;
    }
    return this.getProject(ownerId, id);
  }
  async isUnavailable(projectId: string) {
    const p = await this.db
      .prepare(
        "SELECT id FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id)",
      )
      .bind(projectId)
      .first();
    return !p;
  }
  async listDeletedProjects(ownerId: string) {
    return (
      await this.db
        .prepare(
          "SELECT p.*,d.deleted_at FROM projects p JOIN project_deletions d ON d.project_id=p.id WHERE p.owner_id=? ORDER BY d.deleted_at DESC",
        )
        .bind(ownerId)
        .all<ProjectRecord>()
    ).results;
  }
  private async ownedProject(ownerId: string, projectId: string) {
    const p = await this.db
      .prepare("SELECT * FROM projects WHERE id=? AND owner_id=?")
      .bind(projectId, ownerId)
      .first<ProjectRecord>();
    if (!p) throw new RepositoryError("FORBIDDEN");
    return p;
  }
  async authorizeDeletion(
    ownerId: string,
    projectId: string,
    permanent: boolean,
    confirmationName?: string,
  ) {
    const p = await this.ownedProject(ownerId, projectId);
    if (permanent && confirmationName !== p.name)
      throw new RepositoryError("INVALID_REQUEST");
    return p;
  }
  async isMissing(projectId: string) {
    return !(await this.db
      .prepare("SELECT id FROM projects WHERE id=?")
      .bind(projectId)
      .first());
  }
  async deleteProject(
    ownerId: string,
    projectId: string,
    permanent: boolean,
    confirmationName?: string,
  ) {
    await this.authorizeDeletion(
      ownerId,
      projectId,
      permanent,
      confirmationName,
    );
    const statements = [
      this.db
        .prepare(
          "UPDATE projects SET run_epoch=run_epoch+1,revision=revision+1,active_run_id=NULL WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id)",
        )
        .bind(projectId),
      this.db
        .prepare(
          "UPDATE agent_runs SET status='cancelled' WHERE project_id=? AND status IN ('queued','running','paused','waiting_user','waiting_decision')",
        )
        .bind(projectId),
      this.db
        .prepare(
          "INSERT INTO project_deletions(project_id,deleted_at,permanent) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET permanent=MAX(permanent,excluded.permanent)",
        )
        .bind(projectId, new Date().toISOString(), permanent ? 1 : 0),
    ];
    if (permanent) {
      for (const table of [
        "provider_calls",
        "run_steps",
        "step_receipts",
        "command_receipts",
        "domain_events",
        "decisions",
        "quiz_evaluations",
        "quiz_attempts",
        "question_secrets",
        "quiz_questions",
        "assessment_sessions",
        "assessment_policies",
        "review_schedule",
        "plan_proposals",
        "artifacts",
        "project_constraints",
        "sources",
        "messages",
        "agent_runs",
        "project_creation_receipts",
      ])
        statements.push(
          this.db
            .prepare(`DELETE FROM ${table} WHERE project_id=?`)
            .bind(projectId),
        );
      statements.push(
        this.db
          .prepare("DELETE FROM project_deletions WHERE project_id=?")
          .bind(projectId),
        this.db.prepare("DELETE FROM projects WHERE id=?").bind(projectId),
      );
    }
    await this.db.batch(statements);
  }
  async restoreProject(ownerId: string, projectId: string) {
    await this.ownedProject(ownerId, projectId);
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE projects SET run_epoch=run_epoch+1,revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id)",
        )
        .bind(projectId),
      this.db
        .prepare("DELETE FROM project_deletions WHERE project_id=?")
        .bind(projectId),
    ]);
  }
  async getProject(ownerId: string, projectId: string): Promise<ProjectRecord> {
    const p = await this.db
      .prepare(
        "SELECT * FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id)",
      )
      .bind(projectId)
      .first<ProjectRecord>();
    if (!p || p.owner_id !== ownerId) throw new RepositoryError("FORBIDDEN");
    return p;
  }
  async listProjects(ownerId: string) {
    return (
      await this.db
        .prepare(
          "SELECT * FROM projects WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id) ORDER BY created_at DESC",
        )
        .bind(ownerId)
        .all<ProjectRecord>()
    ).results;
  }
  async acceptCommand(
    ctx: IngressContext,
    raw: CommandEnvelope,
  ): Promise<AcceptedCommand> {
    const input = CommandEnvelopeSchema.parse(raw),
      p = await this.getProject(ctx.owner_id, ctx.project_id),
      hash = await payloadHash(input);
    const replay = async () => {
      const r = await this.db
        .prepare(
          "SELECT * FROM command_receipts WHERE project_id=? AND client_operation_id=?",
        )
        .bind(ctx.project_id, input.client_operation_id)
        .first<{ payload_hash: string; response_json: string }>();
      if (!r) return null;
      if (r.payload_hash !== hash)
        throw new RepositoryError("IDEMPOTENCY_CONFLICT");
      return {
        ...JSON.parse(r.response_json),
        replayed: true,
      } as AcceptedCommand;
    };
    const prior = await replay();
    if (prior) return prior;
    if (input.expected_revision !== p.revision)
      throw new RepositoryError("REVISION_CONFLICT", p.revision);
    const control = [
      "pause_run",
      "cancel_run",
      "resume_run",
      "retry_run",
      "supplement_requirements",
    ].includes(input.command.type);
    if (!control) {
      const active = await this.db
        .prepare(
          "SELECT id FROM agent_runs WHERE project_id=? AND status IN ('queued','running') LIMIT 1",
        )
        .bind(p.id)
        .first();
      if (active) throw new RepositoryError("RUN_BUSY");
    }
    const cmd = input.command,
      isRunControl = control && cmd.type !== "supplement_requirements",
      targetId = isRunControl && "run_id" in cmd ? cmd.run_id : p.active_run_id,
      target =
        control && targetId
          ? await this.db
              .prepare(
                "SELECT id,status,retry_count FROM agent_runs WHERE project_id=? AND id=?",
              )
              .bind(p.id, targetId)
              .first<{ id: string; status: string; retry_count: number }>()
          : null;
    if (isRunControl && (!target || target.id !== p.active_run_id))
      throw new RepositoryError("FORBIDDEN");
    if (
      (cmd.type === "resume_run" && target?.status !== "paused") ||
      (cmd.type === "retry_run" && target?.status !== "failed")
    )
      throw new RepositoryError("INVALID_STAGE");
    if (cmd.type === "retry_run" && target!.retry_count >= 2)
      throw new RepositoryError("BUDGET_EXCEEDED");
    const epoch = control ? p.run_epoch + 1 : p.run_epoch,
      targetStatus =
        cmd.type === "pause_run"
          ? "paused"
          : cmd.type === "cancel_run" || cmd.type === "supplement_requirements"
            ? "cancelled"
            : "queued",
      controlWrites: D1PreparedStatement[] = [];
    if (control && target)
      controlWrites.push(
        this.db
          .prepare(
            "UPDATE agent_runs SET status=?,epoch=?,retry_count=?,error_code=NULL WHERE project_id=? AND id=?",
          )
          .bind(
            targetStatus,
            epoch,
            target.retry_count + (cmd.type === "retry_run" ? 1 : 0),
            p.id,
            target.id,
          ),
      );
    const runId = crypto.randomUUID(),
      messageId = crypto.randomUUID(),
      response = { run_id: runId, revision: p.revision + 1, replayed: false };
    const body =
      "text" in input.command
        ? input.command.text
        : JSON.stringify(input.command);
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO agent_runs(project_id,id,operation_id,epoch,status,command_json) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            p.id,
            runId,
            input.client_operation_id,
            epoch,
            isRunControl ? "succeeded" : "queued",
            JSON.stringify(input.command),
          ),
        this.db
          .prepare("INSERT INTO command_receipts VALUES(?,?,?,?,?,?)")
          .bind(
            p.id,
            input.client_operation_id,
            hash,
            p.revision,
            runId,
            JSON.stringify(response),
          ),
        this.db
          .prepare(
            "INSERT INTO messages(project_id,id,seq,sender_role,body,run_id) SELECT ?,?,COALESCE(MAX(seq),0)+1,'user',?,? FROM messages WHERE project_id=?",
          )
          .bind(p.id, messageId, body, runId, p.id),
        ...controlWrites,
        ...(control
          ? [
              this.db
                .prepare(
                  "INSERT INTO domain_events(project_id,seq,type,payload_json,run_id,role) SELECT ?,COALESCE(MAX(seq),0)+1,?,?,?,'supervisor' FROM domain_events WHERE project_id=?",
                )
                .bind(
                  p.id,
                  cmd.type === "supplement_requirements"
                    ? "handoff_committed"
                    : "role_status_changed",
                  JSON.stringify(
                    cmd.type === "supplement_requirements"
                      ? {
                          from: "supervisor",
                          to: "planner",
                          text: "已保存补充要求并停止旧任务，重新协调后续安排",
                        }
                      : {
                          status: targetStatus,
                          text:
                            cmd.type === "pause_run"
                              ? "协作已暂停，已提交内容保留"
                              : cmd.type === "cancel_run"
                                ? "协作已取消"
                                : "从检查点继续",
                        },
                  ),
                  isRunControl ? targetId : runId,
                  p.id,
                ),
            ]
          : []),
        this.db
          .prepare(
            `UPDATE projects SET revision=revision+1,active_run_id=?,run_epoch=?${cmd.type === "supplement_requirements" ? ",pending_input_json=NULL" : ""} WHERE id=?`,
          )
          .bind(isRunControl ? targetId : runId, epoch, p.id),
      ]);
    } catch (e) {
      const duplicate = await replay();
      if (duplicate) return duplicate;
      throw this.mapError(e);
    }
    return response;
  }
  async readReceipt(
    projectId: string,
    operationId: string,
    stepKey: string,
  ): Promise<StepReceipt | null> {
    const r = await this.db
      .prepare(
        "SELECT * FROM step_receipts WHERE project_id=? AND operation_id=? AND step_key=?",
      )
      .bind(projectId, operationId, stepKey)
      .first<{
        project_id: string;
        operation_id: string;
        step_key: string;
        epoch: number;
        base_revision: number;
        result_json: string;
      }>();
    return r
      ? {
          project_id: r.project_id,
          operation_id: r.operation_id,
          step_key: r.step_key,
          epoch: r.epoch,
          revision: r.base_revision + 1,
          result: JSON.parse(r.result_json),
        }
      : null;
  }
  async commitStep(
    ctx: StepContext,
    writes: StepWriteSet,
  ): Promise<StepReceipt> {
    await this.getProject(ctx.owner_id, ctx.project_id);
    const prior = await this.readReceipt(
      ctx.project_id,
      ctx.operation_id,
      ctx.step_key,
    );
    if (prior) return prior;
    const result = writes.result ?? {};
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare("INSERT INTO step_receipts VALUES(?,?,?,?,?,?)")
        .bind(
          ctx.project_id,
          ctx.operation_id,
          ctx.step_key,
          ctx.epoch,
          ctx.base_revision,
          JSON.stringify(result),
        ),
    ];
    for (const entity of writes.entities ?? []) {
      const allowed = columns[entity.table];
      if (!allowed) throw new RepositoryError("INVALID_ENTITY");
      const row = { ...entity.row, project_id: ctx.project_id };
      if (
        "project_id" in entity.row &&
        entity.row.project_id !== ctx.project_id
      )
        throw new RepositoryError("FORBIDDEN");
      if (entity.table === "artifacts")
        Object.assign(row, { created_by: ctx.actor });
      if (entity.table === "messages" && !("seq" in row)) {
        const keys = Object.keys(row);
        if (keys.some((k) => k !== "project_id" && !allowed.includes(k)))
          throw new RepositoryError("INVALID_FIELD");
        statements.push(
          this.db
            .prepare(
              `INSERT INTO messages(${keys.join(",")},seq) SELECT ${keys.map(() => "?").join(",")},COALESCE(MAX(seq),0)+1 FROM messages WHERE project_id=?`,
            )
            .bind(...Object.values(row), ctx.project_id),
        );
        continue;
      }
      const keys = Object.keys(row);
      if (keys.some((k) => k !== "project_id" && !allowed.includes(k)))
        throw new RepositoryError("INVALID_FIELD");
      statements.push(
        this.db
          .prepare(
            `INSERT INTO ${entity.table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
          )
          .bind(...Object.values(row)),
      );
    }
    for (const event of writes.events ?? [])
      statements.push(
        this.db
          .prepare(
            "INSERT INTO domain_events(project_id,seq,type,payload_json,run_id,role) SELECT ?,COALESCE(MAX(seq),0)+1,?,?,?,? FROM domain_events WHERE project_id=?",
          )
          .bind(
            ctx.project_id,
            event.type,
            JSON.stringify(event.payload),
            event.run_id ?? null,
            event.role ?? null,
            ctx.project_id,
          ),
      );
    const changes = writes.project_changes ?? {},
      keys = Object.keys(changes);
    if (keys.some((k) => !projectKeys.has(k)))
      throw new RepositoryError("INVALID_FIELD");
    statements.push(
      this.db
        .prepare(
          `UPDATE projects SET revision=revision+1${keys.map((k) => `,${k}=?`).join("")} WHERE id=?`,
        )
        .bind(...Object.values(changes), ctx.project_id),
    );
    if (writes.source_changes) {
      const { id, ...v } = writes.source_changes;
      const ks = Object.keys(v);
      if (
        ks.some(
          (k) =>
            ![
              "status",
              "summary",
              "fetched_at",
              "verification_status",
            ].includes(k),
        )
      )
        throw new RepositoryError("INVALID_FIELD");
      statements.push(
        this.db
          .prepare(
            `UPDATE sources SET ${ks.map((k) => `${k}=?`).join(",")} WHERE project_id=? AND id=?`,
          )
          .bind(...Object.values(v), ctx.project_id, id),
      );
    }
    if (writes.policy_changes) {
      if (ctx.actor !== "trusted_ingress")
        throw new RepositoryError("FORBIDDEN");
      const v = writes.policy_changes;
      statements.push(
        this.db
          .prepare(
            "UPDATE assessment_policies SET status=?,policy_json=?,confirmed_message_id=? WHERE project_id=? AND id=? AND status='draft'",
          )
          .bind(
            v.status,
            v.policy_json,
            v.confirmed_message_id,
            ctx.project_id,
            v.id,
          ),
      );
    }
    if (writes.proposal_changes) {
      if (!["planner", "trusted_ingress"].includes(ctx.actor))
        throw new RepositoryError("FORBIDDEN");
      statements.push(
        this.db
          .prepare(
            "UPDATE plan_proposals SET status=? WHERE project_id=? AND id=?",
          )
          .bind(
            writes.proposal_changes.status,
            ctx.project_id,
            writes.proposal_changes.id,
          ),
      );
    }
    if (writes.review_changes) {
      if (ctx.actor !== "curator") throw new RepositoryError("FORBIDDEN");
      const v = writes.review_changes;
      statements.push(
        this.db
          .prepare(
            "UPDATE review_schedule SET status=?,evidence_id=? WHERE project_id=? AND id=?",
          )
          .bind(v.status, v.evidence_id, ctx.project_id, v.id),
      );
    }
    if (writes.provider_changes) {
      const { id, ...v } = writes.provider_changes;
      const ks = Object.keys(v);
      if (ks.some((k) => !["status", "result_json", "usage_json"].includes(k)))
        throw new RepositoryError("INVALID_FIELD");
      statements.push(
        this.db
          .prepare(
            `UPDATE provider_calls SET ${ks.map((k) => `${k}=?`).join(",")} WHERE project_id=? AND id=?`,
          )
          .bind(...Object.values(v), ctx.project_id, id),
      );
    }
    if (writes.run_changes) {
      const { run_id, ...r } = writes.run_changes;
      const ks = Object.keys(r);
      if (
        ks.some(
          (k) =>
            ![
              "status",
              "error_code",
              "budget_json",
              "retry_count",
              "epoch",
            ].includes(k),
        )
      )
        throw new RepositoryError("INVALID_FIELD");
      if (ks.length)
        statements.push(
          this.db
            .prepare(
              `UPDATE agent_runs SET ${ks.map((k) => `${k}=?`).join(",")} WHERE project_id=? AND id=?`,
            )
            .bind(...Object.values(r), ctx.project_id, run_id),
        );
    }
    try {
      await this.db.batch(statements);
    } catch (e) {
      const duplicate = await this.readReceipt(
        ctx.project_id,
        ctx.operation_id,
        ctx.step_key,
      );
      if (duplicate) return duplicate;
      throw this.mapError(e);
    }
    return {
      project_id: ctx.project_id,
      operation_id: ctx.operation_id,
      step_key: ctx.step_key,
      epoch: ctx.epoch,
      revision: ctx.base_revision + 1,
      result,
    };
  }
  async readWorkspace(
    projectId: string,
    fullHistory = false,
  ): Promise<WorkspaceRecord> {
    // All reads share a D1 transaction: never pair a prior revision with newer facts.
    const selections = [
      [
        "messages",
        fullHistory ? "ORDER BY seq DESC" : "ORDER BY seq DESC LIMIT 50",
      ],
      ["artifacts", "ORDER BY version"],
      ["agent_runs", "ORDER BY created_at DESC"],
      ["quiz_questions", ""],
      ["question_secrets", ""],
      ["assessment_policies", "ORDER BY version"],
      ["plan_proposals", "ORDER BY version"],
      ["assessment_sessions", "ORDER BY rowid"],
      ["quiz_attempts", "ORDER BY rowid"],
      ["quiz_evaluations", "ORDER BY rowid"],
      ["review_schedule", ""],
      ["sources", ""],
    ];
    const batch = await this.db.batch([
      this.db
        .prepare(
          "SELECT * FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id)",
        )
        .bind(projectId),
      ...selections.map(([table, tail]) =>
        this.db
          .prepare(
            table === "quiz_attempts"
              ? "SELECT a.*,m.body AS answer_text FROM quiz_attempts a JOIN messages m ON a.project_id=m.project_id AND a.answer_message_id=m.id WHERE a.project_id=? ORDER BY a.rowid"
              : `SELECT * FROM ${table} WHERE project_id=? ${tail}`,
          )
          .bind(projectId),
      ),
      this.db
        .prepare(
          "SELECT COALESCE(MAX(seq),0) AS seq FROM domain_events WHERE project_id=?",
        )
        .bind(projectId),
    ]);
    const project = batch[0].results[0] as unknown as ProjectRecord;
    if (!project) throw new RepositoryError("FORBIDDEN");
    const rows = batch.slice(1, -1).map((r) => r.results);
    return {
      project,
      messages: rows[0].reverse(),
      artifacts: rows[1],
      runs: rows[2],
      questions: rows[3],
      secrets: rows[4],
      policies: rows[5],
      proposals: rows[6],
      sessions: rows[7],
      attempts: rows[8],
      evaluations: rows[9],
      reviews: rows[10],
      sources: rows[11],
      latest_seq: Number(
        (batch.at(-1)!.results[0] as { seq: number } | undefined)?.seq ?? 0,
      ),
    } as unknown as WorkspaceRecord;
  }
  async readEvents(
    projectId: string,
    afterSeq: number,
    limit: number,
  ): Promise<EventRecord[]> {
    return (
      await this.db
        .prepare(
          "SELECT * FROM domain_events WHERE project_id=? AND seq>? ORDER BY seq LIMIT ?",
        )
        .bind(projectId, afterSeq, Math.min(50, Math.max(1, limit)))
        .all<EventRecord>()
    ).results;
  }
  private mapError(e: unknown) {
    const text = String(e);
    for (const code of ["REVISION_CONFLICT", "STALE_EPOCH", "IMMUTABLE_RECORD"])
      if (text.includes(code)) return new RepositoryError(code);
    return e;
  }
}
