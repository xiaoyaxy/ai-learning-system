export interface Env {
  DB: D1Database;
  PROJECT_SUPERVISOR: DurableObjectNamespace;
  DEPLOYMENT_ENV: "local" | "cloud";
  DEV_OWNER_ID?: string;
  AUTH_MODE?: "access" | "demo-password";
  DEMO_ACCESS_PASSWORD?: string;
  DEMO_SESSION_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  ALLOWED_EMAIL?: string;
  ACCESS_JWKS_JSON?: string;
  MODEL_PROVIDER?: string;
  MODEL_NAME?: string;
  MODEL_API_KEY?: string;
  MODEL_API_URL?: string;
  MODEL_THINKING?: "enabled" | "disabled";
  MODEL_TOKEN_PARAMETER?: "max_tokens" | "max_completion_tokens";
  AI?: Ai;
  SEARCH_PROVIDER?: string;
  SEARCH_API_KEY?: string;
  DEMO_MODE?: string;
  DEMO_STEP_DELAY_MS?: string;
}
