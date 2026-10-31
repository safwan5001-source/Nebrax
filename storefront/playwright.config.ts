import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the storefront's fixture-route E2E specs (`e2e/*.spec.ts` that open the `/dev/*` fixture pages).
 *
 * The `webServer` block boots `next dev` (loading `.env.e2e` if one exists) and waits for it to respond. The Laravel-backed
 * wholesale journey has its own config (`playwright.wholesale-e2e.config.ts`), as do the visual-QA suites.
 */
export default defineConfig({
  testDir: "./e2e",
  // Needs the throwaway Laravel stack (scripts/e2e/wholesale-stack.sh) — runs under playwright.wholesale-e2e.config.ts only.
  testIgnore: /wholesale-buyer-journey\.spec\.ts/,
  // Dev-mode Next.js compiles each route on first hit, which blows past Playwright's 30s default on CI runners.
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "./scripts/e2e/dev-with-env.sh",
    url: "http://localhost:3001/us/en",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
