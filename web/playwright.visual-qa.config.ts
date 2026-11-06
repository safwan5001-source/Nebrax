/**
 * FUEL-OPS UI-0 — إعداد Playwright للفحص البصري (مواصفة #1990 §7). يعمل على **نسخة إنتاج** (`next build` ثم `next start`) كي لا
 * يظهر ودجت Next الإرشادي، والخادم مُعترَض بالكامل (لا خلفية):
 *
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts
 *
 * لا يدخل ضمن CI؛ يُشغَّل يدوياً قبل اعتماد أي تغيير على مساحة تشغيل المحطات.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium'].find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: './e2e',
  testMatch: /fuel-ops-(visual-qa(-ui[12])?|b4-manage)\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-visual-qa',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    launchOptions: { executablePath: chromiumExecutable, args: ['--no-sandbox'] },
  },
});
