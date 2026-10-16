import { defineConfig } from "@playwright/test";

/**
 * AWJ-ANIMATED-MEDIA P1 — real-browser check of animated media (`e2e/animated-media-visual.spec.ts`).
 * Needs no backend: the spec answers the same-origin media proxy paths itself.
 *   pnpm exec playwright test -c playwright.animated-media.config.ts
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use an installed Chromium.
 */
const PORT = Number(process.env.ANIMATED_MEDIA_PORT) || 3411;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "animated-media-visual.spec.ts",
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
    url: `http://localhost:${PORT}/dev/animated-media-visual`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
