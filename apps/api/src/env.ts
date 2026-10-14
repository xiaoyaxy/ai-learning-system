export interface Env {
  DB: D1Database;
  PROJECT_SUPERVISOR: DurableObjectNamespace;
  DEPLOYMENT_ENV: "local" | "staging" | "production";
  DEV_OWNER_ID?: string;
  PUBLIC_ORIGIN?: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  ALLOWED_EMAIL?: string;
  ACCESS_JWKS_JSON?: string;
  MODEL_PROVIDER?: string;
  MODEL_NAME?: string;
  MODEL_API_KEY?: string;
  MODEL_API_URL?: string;
  AI?: Ai;
  SEARCH_PROVIDER?: string;
  SEARCH_API_KEY?: string;
  DEMO_MODE?: string;
  DEMO_STEP_DELAY_MS?: string;
}
