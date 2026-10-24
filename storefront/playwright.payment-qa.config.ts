import { defineConfig } from "@playwright/test";

/** PAY-H4-05 visual/behavioural QA of the payment-return page (mobile + desktop, RTL + LTR). */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /payment-return-qa\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
    launchOptions: {
      args: ["--no-sandbox"],
      // Sandboxes pre-install a browser build the project's pinned Playwright does not know: PW_CHROMIUM_PATH points at it.
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node e2e/support/payment-return-api-fixture.mjs",
      port: 4101,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3001/sa/en",
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        AWJ_COMMERCE_API_URL: "http://127.0.0.1:4101",
        AWJ_STOREFRONT_DEV_HOST: "qa.store.awjdev.xyz",
        NEXT_PUBLIC_DEFAULT_COUNTRY: "sa",
        NEXT_PUBLIC_DEFAULT_LOCALE: "en",
      },
    },
  ],
});
