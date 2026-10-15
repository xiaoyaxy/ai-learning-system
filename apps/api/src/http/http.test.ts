import deletionMigration from "../db/migrations/0003_project_deletions.sql?raw";
import { beforeAll, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { ProjectRepository } from "../db/repository";
import migration from "../db/migrations/0001_initial.sql?raw";
import { createApp } from "./routes";
import { authenticate } from "./auth";
import { toWorkspaceDTO, toPublicEvent } from "./projector";
import type { Env } from "../env";
const db = (env as unknown as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.exec(migration);
  await db.exec(deletionMigration);
});
async function fixture() {
  const repo = new ProjectRepository(db),
    owner = crypto.randomUUID();
  const project = await repo.create(owner, {
    client_operation_id: crypto.randomUUID(),
    name: "Agent",
    goal_text: "理解 Agent",
    time_constraint_text: "两周",
    timezone: "Asia/Shanghai",
  });
  const testEnv = {
    DB: db,
    DEPLOYMENT_ENV: "local",
    DEV_OWNER_ID: owner,
    PUBLIC_ORIGIN: "https://app.test",
  } as Env;
  const app = createApp({
    repo,
    dispatcher: {
      accept: async (principal, projectId, envelope) =>
        repo.acceptCommand(
          { owner_id: principal.owner_id, project_id: projectId },
          envelope,
        ),
    },
  });
  return { repo, owner, project, testEnv, app };
}
describe("protected public API", () => {
  it("rejects another owner and checks origin on writes", async () => {
    const { app, project, testEnv } = await fixture();
    expect(
      (
        await app.request(
          "https://app.test/api/v1/projects/" + project.id + "/workspace",
          {},
          { ...testEnv, DEV_OWNER_ID: "other" },
        )
      ).status,
    ).toBe(403);
    const req = new Request("https://app.test/api/v1/projects", {
      method: "POST",
      headers: {
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect((await app.fetch(req, testEnv)).status).toBe(403);
  });
  it("does not trust a spoofed email or development identity in production", async () => {
    const { testEnv } = await fixture();
    await expect(
      authenticate(
        new Request("https://app.test", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.com",
          },
        }),
        { ...testEnv, DEPLOYMENT_ENV: "cloud" },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("validates the signature, issuer, audience and expiry", async () => {
    const { testEnv } = await fixture();
    const keys = await generateKeyPair("RS256", { extractable: true }),
      publicKey = { ...(await exportJWK(keys.publicKey)), kid: "k" };
    const production = {
      ...testEnv,
      DEPLOYMENT_ENV: "cloud",
      ACCESS_ISSUER: "https://access.test",
      ACCESS_AUDIENCE: "learning-aud",
      ALLOWED_EMAIL: "owner@example.com",
      ACCESS_JWKS_JSON: JSON.stringify({ keys: [publicKey] }),
    } as Env;
    const sign = async (aud: string, exp: string) =>
      new SignJWT({ email: "owner@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "k" })
        .setIssuer("https://access.test")
        .setSubject("owner")
        .setAudience(aud)
        .setExpirationTime(exp)
        .sign(keys.privateKey);
    const req = (token: string) =>
      new Request("https://app.test", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      });
    expect(
      await authenticate(req(await sign("learning-aud", "5m")), production),
    ).toEqual({ owner_id: "owner" });
    await expect(
      authenticate(req(await sign("wrong", "5m")), production),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      authenticate(req(await sign("learning-aud", "-1m")), production),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const wrong = await generateKeyPair("RS256");
    const invalid = await new SignJWT({ email: "owner@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k" })
      .setIssuer("https://access.test")
      .setAudience("learning-aud")
      .setSubject("owner")
      .setExpirationTime("5m")
      .sign(wrong.privateKey);
    await expect(authenticate(req(invalid), production)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  it("rejects unknown fields, malformed JSON and oversized text", async () => {
    const { app, project, testEnv } = await fixture();
    const post = (body: string) =>
      app.fetch(
        new Request(
          "https://app.test/api/v1/projects/" + project.id + "/commands",
          {
            method: "POST",
            headers: {
              Origin: "https://app.test",
              "Content-Type": "application/json",
            },
            body,
          },
        ),
        testEnv,
      );
    expect((await post("{")).status).toBe(422);
    expect(
      (
        await post(
          JSON.stringify({
            client_operation_id: crypto.randomUUID(),
            expected_revision: 0,
            command: {
              type: "send_message",
              text: "学 Agent",
              mode: "message",
              actor_role: "coach",
            },
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await post(
          JSON.stringify({
            client_operation_id: crypto.randomUUID(),
            expected_revision: 0,
            command: {
              type: "send_message",
              text: "学".repeat(12001),
              mode: "message",
            },
          }),
        )
      ).status,
    ).toBe(422);
    expect((await post("x".repeat(65537))).status).toBe(413);
  });
  it("returns a revision conflict without invoking another run", async () => {
    const { app, project, testEnv } = await fixture();
    const response = await app.fetch(
      new Request(
        "https://app.test/api/v1/projects/" + project.id + "/commands",
        {
          method: "POST",
          headers: {
            Origin: "https://app.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_operation_id: crypto.randomUUID(),
            expected_revision: 8,
            command: { type: "start_learning" },
          }),
        },
      ),
      testEnv,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("projects public workspace and events without grading secrets", async () => {
    const { repo, project } = await fixture();
    const internal = await repo.readWorkspace(project.id);
    internal.secrets = [
      { reference_answer: "SECRET_CANARY", rubric_json: "private-rubric" },
    ];
    const dto = toWorkspaceDTO(internal);
    expect(JSON.stringify(dto)).not.toContain("SECRET_CANARY");
    expect(JSON.stringify(dto)).not.toContain("rubric");
    expect(
      toPublicEvent({
        project_id: project.id,
        seq: 1,
        type: "question_presented",
        payload_json: JSON.stringify({
          entity_id: "q",
          reference_answer: "SECRET_CANARY",
          rubric: "secret",
        }),
        run_id: null,
        role: "coach",
        occurred_at: "2026-10-14T00:00:00Z",
      }).payload,
    ).toEqual({ entity_id: "q" });
  });
});

it("publishes only safe material fields with summaries for existing projects", async () => {
  const { repo, project } = await fixture();
  const internal = await repo.readWorkspace(project.id);
  internal.sources = [
    {
      id: "s1",
      goal_version: 1,
      reference_no: "M01",
      title: "官方资料",
      url: "https://docs.example.com/guide",
      summary: "可阅读的搜索摘要",
      layer: "intro",
      status: "unavailable",
      verification_status: "pending",
      reference_answer: "PRIVATE_SOURCE_CANARY",
    },
    {
      id: "unsafe",
      goal_version: 1,
      url: "javascript:alert(1)",
      title: "unsafe",
    },
  ];
  const dto = toWorkspaceDTO(internal) as any;
  expect(dto.materials).toHaveLength(1);
  expect(dto.materials[0]).toMatchObject({
    id: "s1",
    summary: "可阅读的搜索摘要",
    url: "https://docs.example.com/guide",
  });
  expect(JSON.stringify(dto)).not.toContain("PRIVATE_SOURCE_CANARY");
});
it("exposes recoverable deletion and exact-name permanent deletion with ownership and origin checks", async () => {
  const { app, project, testEnv } = await fixture(),
    url = "https://app.test/api/v1/projects/" + project.id;
  const remove = (body: unknown, origin = "https://app.test", env = testEnv) =>
    app.request(
      url,
      {
        method: "DELETE",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  expect(
    (
      await remove(
        { permanent: true, confirmation_name: project.name },
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await remove({ permanent: false }, "https://app.test", {
        ...testEnv,
        DEV_OWNER_ID: "other",
      })
    ).status,
  ).toBe(403);
  expect((await remove({ permanent: false })).status).toBe(200);
  expect((await app.request(url + "/workspace", {}, testEnv)).status).toBe(403);
  const trash = (await (
    await app.request("https://app.test/api/v1/projects/deleted", {}, testEnv)
  ).json()) as any[];
  expect(trash.map((p) => p.id)).toContain(project.id);
  expect(
    (await remove({ permanent: true, confirmation_name: "wrong" })).status,
  ).toBe(422);
  expect(
    (await remove({ permanent: true, confirmation_name: project.name })).status,
  ).toBe(200);
  expect(
    (await app.request("https://app.test/api/v1/projects/deleted", {}, testEnv))
      .status,
  ).toBe(200);
});
