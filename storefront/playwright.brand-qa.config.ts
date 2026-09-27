import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-brand-qa-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3001",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--no-sandbox"] },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node e2e/support/store-brand-api-fixture.mjs",
      port: 4100,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm dev",
      url: "http://127.0.0.1:3001/sa/en",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        AWJ_COMMERCE_API_URL: "http://127.0.0.1:4100",
        AWJ_STOREFRONT_DEV_HOST: "qa.store.awjdev.xyz",
      },
    },
  ],
});
