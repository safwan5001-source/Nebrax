import { defineConfig } from "@playwright/test";

/**
 * B2C ACTIVATION READINESS — signed visitor-identity browser E2E (desktop English LTR). Same local stack as the retail-accounts journey.
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
  testMatch: /retail-signed-identity\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/signed-identity-e2e/results.json" }],
  ],
  outputDir: "test-results/signed-identity-e2e/artifacts",
  use: {
    headless: true,
    launchOptions,
    trace: "retain-on-failure",
    screenshot: "on",
  },
  projects: [
    {
      name: "desktop-en",
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
  ],
});
