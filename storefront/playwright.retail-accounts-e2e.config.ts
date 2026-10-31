import { defineConfig } from "@playwright/test";

/**
 * B2C-ACCOUNTS — native retail customer-accounts browser E2E (mobile Arabic RTL + desktop English LTR).
 *
 * Needs a REAL Laravel API (throwaway SQLite, seeded by `e2e/support/retail-accounts-e2e-seed.php`) and a production-mode
 * storefront (`next start`), both booted by `scripts/e2e/retail-accounts-stack.sh`. There is no `webServer` on purpose: the
 * stack is external so the run can never be pointed at a deployed host by accident (the spec refuses non-loopback URLs).
 *
 * `PW_CHROMIUM_PATH` points at the sandbox's pre-installed browser when the pinned Playwright does not know it.
 */
const launchOptions = {
  args: [
    "--no-sandbox",
    // resolve *.e2e.localhost to loopback explicitly (Chromium does this for *.localhost already; this is belt and braces)
    "--host-resolver-rules=MAP *.e2e.localhost 127.0.0.1",
  ],
  ...(process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : {}),
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: /retail-accounts-journey\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/retail-accounts-e2e/results.json" }],
  ],
  outputDir: "test-results/retail-accounts-e2e/artifacts",
  use: {
    headless: true,
    launchOptions,
    trace: "retain-on-failure",
    screenshot: "on",
  },
  projects: [
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
    {
      name: "desktop-en",
      grep: /@desktop/,
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
  ],
});
