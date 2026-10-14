import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  CommandEnvelopeSchema,
  CreateProjectSchema,
  type CommandEnvelope,
  type AcceptedCommand,
} from "@learning/contracts";
import type { ProjectRepository } from "../db/repository";
import { authenticate, type Principal } from "./auth";
import { toWorkspaceDTO, toPublicEvent } from "./projector";
import { ApiError, publicError } from "./errors";
import type { Env } from "../env";
import { exportProject } from "../features/archive/export";
export interface CommandDispatcher {
  accept(
    principal: Principal,
    projectId: string,
    envelope: CommandEnvelope,
  ): Promise<AcceptedCommand>;
  wake?(principal: Principal, projectId: string): Promise<void>;
}
export function createApp(deps: {
  repo: ProjectRepository;
  dispatcher: CommandDispatcher;
}) {
  const app = new Hono<{
    Bindings: Env;
    Variables: { principal: Principal };
  }>();
  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));
  app.use("/api/v1/*", async (c, next) => {
    const principal = await authenticate(c.req.raw, c.env);
    c.set("principal", principal);
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const origin =
        c.env.PUBLIC_ORIGIN ??
        (c.env.DEPLOYMENT_ENV === "local" ? new URL(c.req.url).origin : null);
      if (!origin || c.req.header("Origin") !== origin)
        throw new ApiError("FORBIDDEN", 403);
      if (!c.req.header("Content-Type")?.startsWith("application/json"))
        throw new ApiError("INVALID_REQUEST", 422);
    }
    await next();
  });
  app.get("/api/v1/projects", async (c) => {
    const rows = await deps.repo.listProjects(c.get("principal").owner_id);
    return c.json(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        goal_text: p.goal_text,
        timezone: p.timezone,
        phase: p.phase,
      })),
    );
  });
  app.get("/api/v1/session", (c) =>
    c.json({
      mode:
        c.env.DEPLOYMENT_ENV === "local" && c.env.DEMO_MODE === "true"
          ? "demo"
          : "configured",
      environment: c.env.DEPLOYMENT_ENV,
    }),
  );
  app.post("/api/v1/projects", async (c) => {
    const input = CreateProjectSchema.parse(await readJson(c.req.raw));
    const p = await deps.repo.create(c.get("principal").owner_id, input);
    return c.json({ id: p.id, revision: p.revision }, 201);
  });
  app.get("/api/v1/projects/:id/workspace", async (c) => {
    await deps.repo.getProject(c.get("principal").owner_id, c.req.param("id"));
    await deps.dispatcher.wake?.(c.get("principal"), c.req.param("id"));
    return c.json(
      toWorkspaceDTO(await deps.repo.readWorkspace(c.req.param("id"))),
    );
  });
  app.post("/api/v1/projects/:id/commands", async (c) => {
    const input = CommandEnvelopeSchema.parse(await readJson(c.req.raw));
    await deps.repo.getProject(c.get("principal").owner_id, c.req.param("id"));
    return c.json(
      await deps.dispatcher.accept(
        c.get("principal"),
        c.req.param("id"),
        input,
      ),
      202,
    );
  });
  app.get("/api/v1/projects/:id/events", async (c) => {
    await deps.repo.getProject(c.get("principal").owner_id, c.req.param("id"));
    const after = Number(c.req.query("after_seq") ?? 0),
      limit = Math.min(50, Number(c.req.query("limit") ?? 50));
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    )
      throw new ApiError("INVALID_REQUEST", 422);
    const events = (
      await deps.repo.readEvents(c.req.param("id"), after, limit)
    ).map(toPublicEvent);
    return c.json({
      events,
      next_seq: events.at(-1)?.seq ?? after,
      has_more: events.length === limit,
    });
  });
  app.get("/api/v1/projects/:id/runs/:runId", async (c) => {
    await deps.repo.getProject(c.get("principal").owner_id, c.req.param("id"));
    const workspace = await deps.repo.readWorkspace(c.req.param("id"));
    const run = workspace.runs.find((r) => r.id === c.req.param("runId"));
    if (!run) throw new ApiError("FORBIDDEN", 403);
    return c.json({
      id: run.id,
      status: run.status,
      error_code: run.error_code,
      retryable: run.status === "failed",
      budget: JSON.parse(run.budget_json),
    });
  });
  app.get("/api/v1/projects/:id/artifacts", async (c) => {
    await deps.repo.getProject(c.get("principal").owner_id, c.req.param("id"));
    const artifacts = toWorkspaceDTO(
      await deps.repo.readWorkspace(c.req.param("id")),
    ).artifacts;
    const kind = c.req.query("kind"),
      cursor = Number(c.req.query("cursor") ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new ApiError("INVALID_REQUEST", 422);
    const selected = kind
      ? artifacts.filter((a) => a.kind === kind)
      : artifacts;
    return c.json({
      artifacts: selected.slice(cursor, cursor + 50),
      next_cursor: cursor + 50 < selected.length ? cursor + 50 : null,
    });
  });
  app.get("/api/v1/projects/:id/export", async (c) => {
    await deps.repo.getProject(c.get("principal").owner_id, c.req.param("id"));
    const record = await deps.repo.readWorkspace(c.req.param("id"), true);
    return c.body(
      exportProject(record, toWorkspaceDTO(record).artifacts),
      200,
      {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="learning-${record.project.id}.md"`,
      },
    );
  });
  app.onError((error, c) => {
    if (error.name === "ZodError")
      return c.json(
        {
          code: "INVALID_REQUEST",
          message: "输入格式不正确",
          retryable: false,
        },
        422,
      );
    const { status, body } = publicError(error);
    return c.json(body, status as ContentfulStatusCode);
  });
  return app;
}
async function readJson(request: Request): Promise<unknown> {
  let size = 0;
  const chunks: Uint8Array[] = [];
  const reader = request.body?.getReader();
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new ApiError("BODY_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new ApiError("INVALID_REQUEST", 422);
  }
}
