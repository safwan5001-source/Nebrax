import { defineConfig, devices } from "@playwright/test";

/**
 * AWJ Luxe Motion QA — runs `e2e/luxe-motion-qa.spec.ts` against the real storefront (`pnpm dev`) backed by the
 * synthetic `store/v1` fixture. `LUXE_QA_PRESET=modern` boots the same fixture publishing AWJ Modern (baseline run).
 *
 *   pnpm exec playwright test -c playwright.luxe-qa.config.ts
 *   LUXE_QA_PRESET=modern pnpm exec playwright test -c playwright.luxe-qa.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /luxe-motion-(qa|preview-parity)\.spec\.ts/,
  // Evidence (screenshots, axe JSON, report) lives in test-results/luxe-motion-qa/<preset>; keep Playwright's own
  // per-run output elsewhere so it never wipes it between preset runs.
  outputDir: "test-results/luxe-motion-qa-pw",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/luxe-motion-qa/report.json" }],
  ],
  use: {
    baseURL: "http://localhost:3001",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: point at a pre-installed Chromium whose build differs from the pinned Playwright revision.
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/support/luxe-motion-api-fixture.mjs",
      port: 4120,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3001/sa/en",
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        ...process.env,
        AWJ_COMMERCE_API_URL: "http://127.0.0.1:4120",
        AWJ_STOREFRONT_DEV_HOST: "qa.luxe.test",
        NEXT_PUBLIC_DEFAULT_COUNTRY: "sa",
        NEXT_PUBLIC_DEFAULT_LOCALE: "en",
      } as Record<string, string>,
    },
  ],
});
