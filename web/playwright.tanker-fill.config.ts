/**
 * TANKER-PR7 — مواصفة المتصفح الشاملة لشاشات «تعبئة الصهاريج» في تطبيق المحطات (جوال أولاً)، على نسخة إنتاج قيد التشغيل (بلا خادم تطوير ولا ودجت Next):
 *   npx next build && npx next start -p 3013 &
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3013 npx playwright test -c playwright.tanker-fill.config.ts
 *
 * **ما تغطيه هذه المشاريع — وما لا تغطيه:**
 * - `chromium-*`: محرك Chromium بمحاكاة وصف جهاز «iPhone 15 Pro Max» (مقاس الشاشة، DSF، اللمس، User-Agent). **ليس Safari.**
 * - `webkit-*`: محرك WebKit الخاص بـPlaywright (ليس Safari المُصدَّر مع iOS؛ يشاركه محرك العرض لا واجهة المتصفح ولا لوحة المفاتيح الافتراضية ولا شريط العنوان المتحرك ولا Safe Area الحقيقية)
 *   بمحاكاة الوصف نفسه. يُشغَّل بمتصفحات منفصلة عبر `PLAYWRIGHT_BROWSERS_PATH` إن لم يكن WebKit في المسار الافتراضي.
 * - **أيٌّ من هذه لا يغني عن اختبار Safari على جهاز iPhone حقيقي** (لوحة المفاتيح الفعلية، الكاميرا، اللمس الحقيقي، انقطاع الشبكة الحقيقي، تعليق التبويب في الخلفية).
 * الخادم مُعترَض بالكامل داخل المواصفة (`e2e/support/tanker-fill-mock.ts`)؛ لا خلفية ولا بيانات حقيقية، ولا بوابة إنتاج تُفتح.
 */
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((candidate) => existsSync(candidate));

const portrait = devices['iPhone 15 Pro Max'];
const landscape = devices['iPhone 15 Pro Max landscape'];
const only = process.env.TANKER_ENGINES?.split(',').map((e) => e.trim()) ?? ['chromium', 'webkit'];

const chromiumUse = { launchOptions: { executablePath: chromiumExecutable, args: ['--no-sandbox'] } };
const projects = [
  { name: 'chromium-iphone15pm', engine: 'chromium', use: { ...portrait, defaultBrowserType: 'chromium' as const, ...chromiumUse } },
  { name: 'chromium-iphone15pm-landscape', engine: 'chromium', use: { ...landscape, defaultBrowserType: 'chromium' as const, ...chromiumUse } },
  { name: 'webkit-iphone15pm', engine: 'webkit', use: { ...portrait } },
  { name: 'webkit-iphone15pm-landscape', engine: 'webkit', use: { ...landscape } },
].filter((project) => only.includes(project.engine)).map(({ engine: _engine, ...project }) => project);

export default defineConfig({
  testDir: './e2e',
  testMatch: /tanker-fill-mobile\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results-tanker/report.json' }]],
  outputDir: 'test-results-tanker/artifacts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects,
});
