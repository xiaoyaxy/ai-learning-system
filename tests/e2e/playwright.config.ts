import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8787", trace: "retain-on-failure" },
  reporter: "list",
  webServer: {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:8787/api/v1/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
