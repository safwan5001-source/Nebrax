/**
 * FUEL-PRICES (#2011) — مواصفة المتصفح + لقطات الجوال على نسخة تعمل (dev أو start):
 *   npx next dev -p 3013 &    (أو next build && next start -p 3013)
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3013 FP_SHOTS=/path/to/out npx playwright test -c playwright.fuel-prices.config.ts
 * الخادم مُعترَض بالكامل (بيانات اصطناعية)؛ لا CI يشغّلها تلقائياً. Chromium بمقاس آيفون ≠ Safari الحقيقي.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium'].find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: './e2e',
  testMatch: /fuel-prices-2011\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-fuel-prices',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013',
    headless: true,
    launchOptions: { executablePath: chromiumExecutable, args: ['--no-sandbox'] },
  },
  projects: [
    { name: 'iphone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
  ],
});
