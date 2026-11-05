/**
 * FUEL-OPS #2021 — مواصفة المتصفح لملخص النقد (D1/D2/D5) على نسخة إنتاج قيد التشغيل (بلا خادم تطوير):
 *   NODE_OPTIONS=--max-old-space-size=10240 npx next build && npx next start -p 3012 &
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.fuel-ops-cash.config.ts
 * الخادم مُعترَض بالكامل داخل المواصفة (بيانات Fixture)؛ لا CI يشغّلها تلقائياً. Chromium بمقاس آيفون ≠ Safari الحقيقي.
 * ملف إعداد مستقل عمداً كي لا يتعارض مع `playwright.fuel-ops.config.ts` الذي يعدّله PR #2013.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium'].find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: './e2e',
  testMatch: /fuel-ops-cash-summary\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-fuel-ops-cash',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012',
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: chromiumExecutable, args: ['--no-sandbox'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
