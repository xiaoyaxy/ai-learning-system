import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";
import { ApiError } from "./errors";
export interface Principal {
  owner_id: string;
}
const remoteKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authenticate(
  request: Request,
  env: Env,
): Promise<Principal> {
  if (env.DEPLOYMENT_ENV === "local" && env.DEV_OWNER_ID)
    return { owner_id: env.DEV_OWNER_ID };
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE || !env.ALLOWED_EMAIL)
    throw new ApiError("UNAUTHENTICATED", 401);
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("CF_Authorization="))
      ?.slice("CF_Authorization=".length);
  if (!token) throw new ApiError("UNAUTHENTICATED", 401);
  try {
    const issuer = new URL(env.ACCESS_ISSUER);
    if (issuer.protocol !== "https:") throw new Error("issuer");
    const keyUrl = new URL("/cdn-cgi/access/certs", issuer).href;
    let keys;
    if (env.ACCESS_JWKS_JSON)
      keys = createLocalJWKSet(JSON.parse(env.ACCESS_JWKS_JSON));
    else {
      keys = remoteKeys.get(keyUrl) ?? createRemoteJWKSet(new URL(keyUrl));
      remoteKeys.set(keyUrl, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: env.ACCESS_ISSUER,
      audience: env.ACCESS_AUDIENCE,
      algorithms: ["RS256"],
    });
    if (payload.email !== env.ALLOWED_EMAIL || !payload.sub)
      throw new Error("identity");
    return { owner_id: payload.sub };
  } catch {
    throw new ApiError("UNAUTHENTICATED", 401);
  }
}
