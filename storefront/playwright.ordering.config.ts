import { defineConfig } from "@playwright/test";

/**
 * COPS-H4 Buyer Ordering UX — real-browser check of the intake notices (`e2e/ordering-notice-visual.spec.ts`).
 * Needs no backend: it renders the real components on `/dev/ordering-visual`.
 *   pnpm exec playwright test -c playwright.ordering.config.ts
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use an installed Chromium; ORDERING_QA_SHOTS=<dir> saves screenshots.
 */
const PORT = Number(process.env.ORDERING_QA_PORT) || 3412;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "ordering-notice-visual.spec.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox"],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/dev/ordering-visual`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
