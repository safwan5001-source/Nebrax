import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * AWJ-VD-H1 / VD-5 — Playwright config for `e2e/vd5-visual-dimensions.spec.ts` ONLY.
 *
 * Not part of CI and no `webServer` on purpose: the spec talks to an already running local stack (Laravel with a
 * real database, an R2-compatible store, and this storefront in dev mode) described by a JSON file.
 *
 *   VD5_STACK_ENV=/path/to/env.json \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
 *   pnpm exec playwright test -c playwright.vd5.config.ts
 *
 * The spec starts a small host-rewriting proxy (see `startBrowseProxy`) and the browser uses
 * `http://localhost:<VD5_BROWSE_PORT, default 3317>`: `next dev` never hydrates a page served under the storefront's
 * managed hostname (its HMR socket is blocked there), while the facet-image proxy needs that hostname as `Host`.
 * Chromium args (host-resolver rules, --no-sandbox) come from the stack file. Without `VD5_STACK_ENV` the spec skips
 * itself with a reason.
 */
type StackFile = {
  chromium?: { args?: string[] };
};

const stackPath = process.env.VD5_STACK_ENV;
const stack: StackFile = stackPath
  ? (JSON.parse(readFileSync(stackPath, "utf8")) as StackFile)
  : {};

export default defineConfig({
  testDir: "./e2e",
  testMatch: "vd5-visual-dimensions.spec.ts",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${Number(process.env.VD5_BROWSE_PORT) || 3317}`,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: stack.chromium?.args ?? ["--no-sandbox"],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
