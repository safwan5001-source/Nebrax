import { defineConfig } from "@playwright/test";

/**
 * H6 Batch L — native wholesale buyer browser E2E.
 *
 * Unlike the other suites this one needs a REAL Laravel API (throwaway SQLite, seeded by
 * `e2e/support/wholesale-e2e-seed.php`) and a production-mode storefront (`next start`), both booted by
 * `scripts/e2e/wholesale-stack.sh`. There is no `webServer` here on purpose: the stack is external so the run
 * can never be pointed at a deployed host by accident (the spec refuses non-loopback API/store URLs).
 *
 * `PW_CHROMIUM_PATH` points at the sandbox's pre-installed browser when the pinned Playwright does not know it.
 */
const launchOptions = {
  args: ["--no-sandbox"],
  ...(process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : {}),
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: /wholesale-buyer-journey\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/wholesale-e2e/results.json" }],
  ],
  outputDir: "test-results/wholesale-e2e/artifacts",
  use: {
    headless: true,
    launchOptions,
    trace: "on",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-en",
      grep: /@desktop/,
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-ar",
      grep: /@mobile/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-SA",
      },
    },
  ],
});
