import { it, expect, vi } from "vitest";
import type { Env } from "../env";
import { ConfiguredModelGateway } from "./model";
import { ConfiguredSearchProvider } from "./search";
import { checkReadiness } from "./readiness";
import type { RoleModelRequest } from "./model";
const configured = {
  DEPLOYMENT_ENV: "local",
  MODEL_PROVIDER: "compatible",
  MODEL_NAME: "test-model",
  MODEL_API_URL: "https://api.example.com/v1/chat/completions",
  MODEL_API_KEY: "test-key",
} as Env;
const request: RoleModelRequest = {
  schema_name: "message",
  system: "只输出 JSON",
  task: {
    project_id: "p",
    run_id: "r",
    epoch: 1,
    step_key: "message",
    role: "planner",
    action: "message",
    evidence_ids: [],
    public_context: { text: "用户原话", output_contract: { text: "string" } },
  },
};
const payload = {
  kind: "message",
  content: { text: "先明确目标" },
  evidence_ids: [],
};
const response =
  (
    status = 200,
    body: unknown = {
      choices: [{ message: { content: JSON.stringify(payload) } }],
    },
  ) =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "fixture-request",
      },
    });
it("maps 429 and 401 without exposing provider messages or keys", async () => {
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(429, { error: "SECRET_PROVIDER_BODY" }),
    }).generate(request),
  ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  await expect(
    new ConfiguredModelGateway(configured, { fetch: response(401) }).generate(
      request,
    ),
  ).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
});
it("keeps unavailable usage null and prevents generated fake billing metadata", async () => {
  const output = await new ConfiguredModelGateway(configured, {
    fetch: response(),
  }).generate(request);
  expect(output.usage).toBeNull();
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ ...payload, usage: { neurons: 0 } }),
            },
          },
        ],
      }),
    }).generate(request),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_RESULT" });
});
it("preserves actual reported usage and model provenance", async () => {
  const output = await new ConfiguredModelGateway(configured, {
    fetch: response(200, {
      id: "call-real",
      model: "served-model-version",
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    }),
  }).generate(request);
  expect(output).toMatchObject({
    model: "served-model-version",
    provider: "compatible",
    request_id: "call-real",
    usage: { input_tokens: 12, output_tokens: 8 },
  });
});
it("validates complete JSON and enforces a hard deadline even if transport ignores abort", async () => {
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [{ message: { content: "```json bad" } }],
      }),
    }).generate(request),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_RESULT" });
  const call = vi.fn(() => new Promise<Response>(() => {}));
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: call,
      timeout_ms: 10,
    }).generate(request),
  ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  expect(call).toHaveBeenCalledTimes(1);
});
it("never gives private grading context to another role or follows API redirects", async () => {
  const call = vi.fn<typeof fetch>(response());
  await expect(
    new ConfiguredModelGateway(configured, { fetch: call }).generate({
      ...request,
      task: {
        ...request.task,
        private_context: { reference_answer: "SECRET" },
      },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(call).not.toHaveBeenCalled();
  await new ConfiguredModelGateway(configured, { fetch: call }).generate(
    request,
  );
  expect(call.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  expect(JSON.parse(String(call.mock.calls[0][1]?.body))).toMatchObject({
    model: "test-model",
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });
});
it("uses the native Workers AI binding with the exact configured model", async () => {
  const run = vi.fn(
    async (_model: string, _input: Record<string, unknown>) => ({
      response: JSON.stringify(payload),
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    }),
  );
  const output = await new ConfiguredModelGateway({
    ...configured,
    MODEL_PROVIDER: "workers-ai",
    AI: { run } as unknown as Ai,
  }).generate(request);
  expect(run.mock.calls[0][0]).toBe("test-model");
  expect(output.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
});
it("fails closed for missing configuration, cloud auth readiness", async () => {
  expect(
    checkReadiness({
      DEPLOYMENT_ENV: "cloud",
      DEV_OWNER_ID: "not-a-production-login",
    } as Env).authentication,
  ).toBe(false);
  await expect(
    new ConfiguredModelGateway({
      DEPLOYMENT_ENV: "cloud",
      DEMO_MODE: "true",
    } as Env).generate(request),
  ).rejects.toMatchObject({ code: "CONFIGURATION_REQUIRED" });
  await expect(
    new ConfiguredModelGateway(
      { ...configured, DEPLOYMENT_ENV: "cloud" },
      { fetch: response() },
    ).generate(request),
  ).resolves.toMatchObject({ kind: "message" });
});
it("searches only the fixed selected endpoint and leaves unsafe hits out", async () => {
  const call = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "权威资料",
              url: "https://example.org/guide",
              content: "摘要",
            },
            { title: "私网", url: "https://127.0.0.1/", content: "不可用" },
          ],
        }),
      ),
  );
  const hits = await new ConfiguredSearchProvider(
    {
      DEPLOYMENT_ENV: "local",
      SEARCH_PROVIDER: "tavily",
      SEARCH_API_KEY: "test-key",
    } as Env,
    { fetch: call },
  ).search("Agent 入门", { project_id: "p", goal_version: 1 });
  expect(hits).toHaveLength(1);
  expect(call.mock.calls[0][0]).toBe("https://api.tavily.com/search");
  expect(call.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  await expect(
    new ConfiguredSearchProvider(
      { DEPLOYMENT_ENV: "cloud", DEMO_MODE: "true" } as Env,
      { fetch: call },
    ).search("query", { project_id: "p", goal_version: 1 }),
  ).rejects.toMatchObject({ code: "CONFIGURATION_REQUIRED" });
});

it("keeps committed artifacts unchanged when a D1 business write fails", async () => {
  const { env } = await import("cloudflare:workers"),
    { ProjectRepository } = await import("../db/repository"),
    { TaskRunner } = await import("../runtime/runner"),
    { default: migration } =
      await import("../db/migrations/0001_initial.sql?raw");
  const db = (env as unknown as { DB: D1Database }).DB;
  await db.exec(migration);
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID(),
    p = await repo.create(owner, {
      client_operation_id: crypto.randomUUID(),
      name: "存储失败",
      goal_text: "学习",
      time_constraint_text: "",
      timezone: "Asia/Shanghai",
    }),
    op = crypto.randomUUID(),
    a = await repo.acceptCommand(
      { owner_id: owner, project_id: p.id },
      {
        client_operation_id: op,
        expected_revision: 0,
        command: { type: "send_message", mode: "message", text: "原话保留" },
      },
    );
  const sql = new WeakMap<object, string>(),
    broken = new Proxy(db, {
      get(target, key) {
        if (key === "prepare")
          return (query: string) => {
            const statement = target.prepare(query);
            return new Proxy(statement, {
              get(s, k) {
                if (k === "bind")
                  return (...args: any[]) => {
                    const bound = s.bind(...args);
                    sql.set(bound, query);
                    return bound;
                  };
                const v = (s as any)[k];
                return typeof v === "function" ? v.bind(s) : v;
              },
            });
          };
        if (key === "batch")
          return (statements: D1PreparedStatement[]) => {
            if (
              statements.some((s) =>
                sql.get(s)?.startsWith("INSERT INTO artifacts"),
              )
            )
              throw new Error("D1_ERROR: business writes unavailable");
            return target.batch(statements);
          };
        const value = (target as any)[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const brokenRepo = new ProjectRepository(broken),
    before = (await repo.readWorkspace(p.id)).artifacts;
  await expect(
    new TaskRunner(brokenRepo).executeStep(
      { owner_id: owner, project_id: p.id },
      a.run_id,
      {
        key: "business",
        role: "planner",
        action: { type: "write_artifact", kind: "definition" },
        input: {},
      },
      async () => ({ ...payload, usage: null }),
      () => ({
        entities: [
          {
            table: "artifacts",
            row: {
              id: "not-saved",
              kind: "definition",
              version: 1,
              content: "不会保存",
              evidence_message_ids: "[]",
            },
          },
        ],
      }),
    ),
  ).rejects.toThrow("D1_ERROR");
  const after = await repo.readWorkspace(p.id);
  expect(after.artifacts).toEqual(before);
  expect(after.messages[0].body).toBe("原话保留");
  expect(after.runs[0].error_code).toBe("STORAGE_UNAVAILABLE");
});

it("rejects invalid routing and empty replies before they can enter the replay cache", async () => {
  const invalid = {
    kind: "route",
    content: { role: "database_admin" },
    evidence_ids: [],
  };
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [{ message: { content: JSON.stringify(invalid) } }],
      }),
    }).generate({
      ...request,
      schema_name: "route",
      task: { ...request.task, role: "supervisor", action: "route" },
    }),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_RESULT" });
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ ...payload, content: { text: "" } }),
            },
          },
        ],
      }),
    }).generate(request),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_RESULT" });
});

it("passes an explicit DeepSeek thinking setting without changing other compatible providers", async () => {
  const call = vi.fn<typeof fetch>(response());
  await new ConfiguredModelGateway(
    { ...configured, MODEL_THINKING: "disabled" } as Env,
    { fetch: call },
  ).generate(request);
  expect(JSON.parse(String(call.mock.calls[0][1]?.body))).toMatchObject({
    thinking: { type: "disabled" },
  });
  const normal = vi.fn<typeof fetch>(response());
  await new ConfiguredModelGateway(configured, { fetch: normal }).generate(
    request,
  );
  expect(JSON.parse(String(normal.mock.calls[0][1]?.body))).not.toHaveProperty(
    "thinking",
  );
});

it("uses Workers-supported manual redirects and rejects redirect responses without following them", async () => {
  const nativeStyle = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.redirect === "error")
      throw new TypeError(
        "Invalid redirect value: Workers supports follow or manual",
      );
    return response()();
  });
  await expect(
    new ConfiguredModelGateway(configured, { fetch: nativeStyle }).generate(
      request,
    ),
  ).resolves.toMatchObject({ kind: "message" });
  const redirected = vi.fn<typeof fetch>(
    async () =>
      new Response("", {
        status: 302,
        headers: { Location: "https://other.example.com" },
      }),
  );
  await expect(
    new ConfiguredModelGateway(configured, { fetch: redirected }).generate(
      request,
    ),
  ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  expect(redirected).toHaveBeenCalledTimes(1);
});

it("gives the model a complete envelope schema with a fixed outer kind", async () => {
  const call = vi.fn<typeof fetch>(response());
  await new ConfiguredModelGateway(configured, { fetch: call }).generate(
    request,
  );
  const body = JSON.parse(String(call.mock.calls[0][1]?.body));
  expect(body.messages[0].content).toContain('"kind":{"const":"message"}');
  expect(body.messages[0].content).toContain(
    '"required":["kind","content","evidence_ids"]',
  );
});

it("binds result kind to the requested action only after validating its concrete content schema", async () => {
  const call = response(200, {
    choices: [
      {
        message: {
          content: JSON.stringify({ ...payload, kind: "definition" }),
        },
      },
    ],
  });
  await expect(
    new ConfiguredModelGateway(configured, { fetch: call }).generate(request),
  ).resolves.toMatchObject({
    kind: "message",
    content: { text: "先明确目标" },
  });
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: "definition",
                content: { role: "planner" },
                evidence_ids: [],
              }),
            },
          },
        ],
      }),
    }).generate(request),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_RESULT" });
});

it("handles a completed model response with one redundant closing brace without changing text", async () => {
  const result = {
    ...payload,
    content: { text: "文本中有 } } 和 {，这些必须保留。" },
  };
  const malformed = JSON.stringify(result).replace(
    '},"evidence_ids"',
    '}},"evidence_ids"',
  );
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [{ finish_reason: "stop", message: { content: malformed } }],
      }),
    }).generate(request),
  ).resolves.toMatchObject(result);
});
it("does not repair truncated outputs or accept invented usage fields after a syntax repair", async () => {
  const malformed = JSON.stringify(payload).replace(
    '},"evidence_ids"',
    '}},"evidence_ids"',
  );
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [{ finish_reason: "length", message: { content: malformed } }],
      }),
    }).generate(request),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_RESULT" });
  const fake = JSON.stringify({
    ...payload,
    usage: { input_tokens: 0 },
  }).replace('},"evidence_ids"', '}},"evidence_ids"');
  await expect(
    new ConfiguredModelGateway(configured, {
      fetch: response(200, {
        choices: [{ finish_reason: "stop", message: { content: fake } }],
      }),
    }).generate(request),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_RESULT" });
});
