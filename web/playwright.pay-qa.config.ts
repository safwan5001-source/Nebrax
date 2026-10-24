/**
 * PAY-H8-02 — إعداد Playwright لمسح شاشات المدفوعات (الخادم مُعترَض بالكامل، لا خلفية). يعمل على منفذ خاص كي لا يصطدم بغيره:
 *
 *   PAY_QA_SHOTS=/tmp/pay-qa-shots npx playwright test -c playwright.pay-qa.config.ts
 *
 * لا يدخل ضمن CI (مصفوفة كبيرة)؛ يُشغَّل يدوياً قبل الإغلاق وعند تغيير شاشات المدفوعات.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PAY_QA_PORT ?? 3917);
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium'].find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: './e2e',
  testMatch: /pay-h8-02-payments-screens\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-pay-qa',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'off',
    launchOptions: { executablePath: chromiumExecutable, args: ['--no-sandbox'] },
  },
  projects: [{ name: 'chromium', use: { viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
