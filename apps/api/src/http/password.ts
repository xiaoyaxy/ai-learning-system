import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { Env } from "../env";
import { ApiError } from "./errors";
const cookieName = "__Host-learning_session";
const issuer = "ai-learning-system";
const duration = 12 * 60 * 60;
export function demoPasswordConfigured(env: Env): boolean {
  try {
    return (
      env.AUTH_MODE === "demo-password" &&
      (env.DEMO_ACCESS_PASSWORD?.length ?? 0) >= 16 &&
      (env.DEMO_SESSION_SECRET?.length ?? 0) >= 32 &&
      new URL(env.PUBLIC_ORIGIN!).origin === env.PUBLIC_ORIGIN &&
      env.PUBLIC_ORIGIN!.startsWith("https://")
    );
  } catch {
    return false;
  }
}
export async function loginDemo(
  request: Request,
  env: Env,
  body: unknown,
): Promise<Response> {
  if (!demoPasswordConfigured(env))
    throw new ApiError("CONFIGURATION_REQUIRED", 503);
  if (request.headers.get("Origin") !== env.PUBLIC_ORIGIN)
    throw new ApiError("FORBIDDEN", 403);
  const parsed = z
    .object({ password: z.string().min(1).max(256) })
    .strict()
    .safeParse(body);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", 422);
  const encoder = new TextEncoder();
  const hashes = await Promise.all(
    [parsed.data.password, env.DEMO_ACCESS_PASSWORD!].map((s) =>
      crypto.subtle.digest("SHA-256", encoder.encode(s)),
    ),
  );
  const left = new Uint8Array(hashes[0]),
    right = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  if (difference !== 0) throw new ApiError("UNAUTHENTICATED", 401);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setSubject("demo-owner")
    .setAudience(env.PUBLIC_ORIGIN!)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + duration)
    .sign(encoder.encode(env.DEMO_SESSION_SECRET));
  return Response.json(
    { status: "authenticated" },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${cookieName}=${token}; Path=/; Max-Age=${duration}; HttpOnly; Secure; SameSite=Strict`,
      },
    },
  );
}
export async function verifyDemoSession(
  request: Request,
  env: Env,
): Promise<{ owner_id: string }> {
  if (!demoPasswordConfigured(env)) throw new ApiError("UNAUTHENTICATED", 401);
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!token) throw new ApiError("UNAUTHENTICATED", 401);
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.DEMO_SESSION_SECRET),
      { issuer, audience: env.PUBLIC_ORIGIN, algorithms: ["HS256"] },
    );
    if (payload.sub !== "demo-owner" || typeof payload.exp !== "number")
      throw new Error("identity");
    return { owner_id: "demo-owner" };
  } catch {
    throw new ApiError("UNAUTHENTICATED", 401);
  }
}
