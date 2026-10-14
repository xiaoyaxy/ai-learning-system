import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./test-worker.ts",
      additionalExports: {
        EchoChild: "DurableObject",
        ProjectSupervisor: "DurableObject",
        PlannerAgent: "DurableObject",
        CuratorAgent: "DurableObject",
        CoachAgent: "DurableObject",
      },
      miniflare: {
        compatibilityDate: "2026-10-13",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        durableObjects: {
          TEST_PARENT: { className: "TestParent", useSQLite: true },
          PROJECT_SUPERVISOR: {
            className: "ProjectSupervisor",
            useSQLite: true,
          },
        },
      },
    }),
  ],
  test: { include: ["src/**/*.test.ts"], fileParallelism: false },
});
