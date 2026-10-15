/**
 * AWJ-VD-H1 / VD-5 — Playwright config for the stack-dependent visual-dimensions spec.
 *
 * Unlike `playwright.config.ts` this has NO `webServer`: the spec needs a live Laravel API, a seeded tenant and the admin
 * app already running, and it is not part of CI. Point it at the stack with:
 *
 *   VD5_STACK_ENV=/path/to/env.json PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
 *     npx playwright test -c playwright.vd5.config.ts
 *
 * The admin base URL comes from `PLAYWRIGHT_BASE_URL`, else from `urls.admin` in the env file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

function adminUrlFromEnvFile(): string | undefined {
  const path = process.env.VD5_STACK_ENV;
  if (!path || !existsSync(path)) return undefined;
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as { urls?: { admin?: string } }).urls?.admin;
  } catch {
    return undefined;
  }
}

const chromiumExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((candidate) =>
    existsSync(candidate),
  );

export default defineConfig({
  testDir: './e2e',
  testMatch: /vd5-visual-dimensions\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? adminUrlFromEnvFile(),
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: chromiumExecutable, args: ['--no-sandbox'] },
  },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 960 } } }],
});
