import { it, expect } from "vitest";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authenticate } from "./auth";
import { loginDemo } from "./password";
const origin = "https://learning.example.com";
const configured = {
  DEPLOYMENT_ENV: "cloud",
  AUTH_MODE: "demo-password",
  PUBLIC_ORIGIN: origin,
  DEMO_ACCESS_PASSWORD: "test-password-canary",
  DEMO_SESSION_SECRET: "a-test-signing-secret-with-more-than-32-bytes",
} as unknown as Env;
const request = (headers: Record<string, string> = { Origin: origin }) =>
  new Request(origin + "/api/v1/login", { method: "POST", headers });
it("uses a secure HTTP-only cookie and authenticates the same single demo owner", async () => {
  const response = await loginDemo(request(), configured, {
    password: "test-password-canary",
  });
  const cookie = response.headers.get("Set-Cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).toContain("Path=/");
  expect(await response.text()).not.toContain("test-password-canary");
  expect(
    await authenticate(
      new Request(origin + "/api/v1/projects", {
        headers: { Cookie: cookie.split(";")[0] },
      }),
      configured,
    ),
  ).toEqual({ owner_id: "demo-owner" });
});
it("rejects wrong passwords and cross-origin login", async () => {
  await expect(
    loginDemo(request(), configured, { password: "wrong" }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    loginDemo(request({ Origin: "https://other.example.com" }), configured, {
      password: "test-password-canary",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("fails closed when cloud password login is not configured", async () => {
  await expect(
    loginDemo(
      request(),
      { ...configured, DEMO_SESSION_SECRET: undefined } as Env,
      { password: "test-password-canary" },
    ),
  ).rejects.toMatchObject({ code: "CONFIGURATION_REQUIRED" });
  await expect(
    authenticate(new Request(origin), {
      ...configured,
      DEV_OWNER_ID: "unsafe",
      DEMO_SESSION_SECRET: undefined,
    } as Env),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});
it("rejects expired, wrong-audience and forged session cookies", async () => {
  const key = new TextEncoder().encode((configured as any).DEMO_SESSION_SECRET);
  for (const [aud, exp] of [
    [origin, 1],
    ["https://other.example.com", Math.floor(Date.now() / 1000) + 1000],
  ] as const) {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("ai-learning-system")
      .setSubject("demo-owner")
      .setAudience(aud)
      .setExpirationTime(exp)
      .sign(key);
    await expect(
      authenticate(
        new Request(origin, {
          headers: { Cookie: "__Host-learning_session=" + token },
        }),
        configured,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  }
  await expect(
    authenticate(
      new Request(origin, {
        headers: { Cookie: "__Host-learning_session=forged" },
      }),
      configured,
    ),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});
