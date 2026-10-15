import type { Env } from "../env";
import { demoPasswordConfigured } from "../http/password";
import { publicHttpsUrl } from "./source-reader";
export function checkReadiness(env: Env) {
  const local = env.DEPLOYMENT_ENV === "local",
    demo = local && env.DEMO_MODE === "true";
  let authentication = local && !!env.DEV_OWNER_ID;
  try {
    if (!local)
      authentication =
        !!env.ALLOWED_EMAIL?.includes("@") &&
        !!env.ACCESS_AUDIENCE &&
        new URL(env.ACCESS_ISSUER ?? "").protocol === "https:" &&
        new URL(env.PUBLIC_ORIGIN ?? "").origin === env.PUBLIC_ORIGIN &&
        env.PUBLIC_ORIGIN!.startsWith("https://");
  } catch {
    authentication = false;
  }
  if (!local && env.AUTH_MODE === "demo-password")
    authentication = demoPasswordConfigured(env);
  const model =
    demo ||
    (!!env.MODEL_NAME &&
      (env.MODEL_PROVIDER === "workers-ai"
        ? !!env.AI
        : env.MODEL_PROVIDER === "compatible" &&
          !!env.MODEL_API_KEY &&
          !!publicHttpsUrl(env.MODEL_API_URL ?? "")));
  return {
    authentication,
    provider: {
      model,
      search:
        demo || (env.SEARCH_PROVIDER === "tavily" && !!env.SEARCH_API_KEY),
      mode: demo ? "local-fixture" : "configured",
    },
    compatibility: { date: "2026-10-13", rpc_and_schedule_tested: true },
    storage: {
      bindings_present: !!env.DB && !!env.PROJECT_SUPERVISOR,
      writable: "not_probed",
    },
    budget: {
      model: 8,
      tool: 12,
      handoff: 6,
      output_tokens: 2048,
      source_chars: 8000,
      context_chars: 24000,
      timeout_ms: 30000,
    },
    source_reading: {
      verified_full_text: false,
      mode: "links_and_search_snippets",
    },
    completion:
      "requires project-specific confirmed policy and complete quiz evidence",
  };
}
