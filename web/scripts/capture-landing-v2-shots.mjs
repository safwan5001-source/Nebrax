/**
 * لقطات صفحة الهبوط V2 من المنتج نفسه في وضع المعاينة (بيانات تجريبية محلية، بلا خادم).
 * لا تُرسم أي شاشة يدوياً: كل صورة هنا لقطة لمسار حقيقي في التطبيق، بالسمتين واللغتين.
 *
 * التشغيل (مع خادم تطوير على 3001):
 *   npx next dev -p 3001
 *   node scripts/capture-landing-v2-shots.mjs
 *
 * يُخفى شريط «وضع المعاينة» ومؤشر أدوات التطوير فقط؛ لا يُعدَّل أي محتوى آخر في الصفحة.
 */
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const outputDir = resolve(process.cwd(), 'public/landing');
const executablePath = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((path) => existsSync(path));

const user = {
  id: 'demo-user',
  name: 'مستخدم المعاينة',
  email: 'demo@nibras.test',
  role: 'owner',
  permissions: ['*'],
  tenant_id: 'demo-tenant',
};

/** الاسم ← المسار والإطار. `width` عرض ملف WebP النهائي. */
const SHOTS = [
  { name: 'app-dashboard', route: '/dashboard', viewport: { width: 1440, height: 900 }, width: 2000 },
  { name: 'app-pos-audit', route: '/pos/audit', viewport: { width: 1440, height: 900 }, width: 2000 },
  { name: 'app-fuel', route: '/fuel-stations', viewport: { width: 1440, height: 900 }, width: 2000 },
  { name: 'phone-pos-audit', route: '/pos/audit', viewport: { width: 390, height: 844 }, width: 780, mobile: true },
  { name: 'phone-fuel', route: '/fuel-stations', viewport: { width: 390, height: 844 }, width: 780, mobile: true },
];

const HIDE_CHROME = `
  nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
`;

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

for (const shot of SHOTS) {
  for (const theme of ['light', 'dark']) {
    for (const locale of ['ar', 'en']) {
      const context = await browser.newContext({
        viewport: shot.viewport,
        deviceScaleFactor: 2,
        isMobile: Boolean(shot.mobile),
        hasTouch: Boolean(shot.mobile),
      });
      await context.addCookies([{ name: 'locale', value: locale, url: baseURL }]);
      await context.addInitScript(
        ({ demoUser, selectedTheme }) => {
          localStorage.setItem('demo', 'true');
          localStorage.setItem('user', JSON.stringify(demoUser));
          localStorage.setItem('theme', selectedTheme);
        },
        { demoUser: user, selectedTheme: theme }
      );
      const page = await context.newPage();
      await page.goto(`${baseURL}${shot.route}`, { waitUntil: 'networkidle', timeout: 120_000 });
      await page.addStyleTag({ content: HIDE_CHROME });
      // شريط وضع المعاينة: يُغلق بزرّه الخاص كما يفعل المستخدم.
      await page.evaluate(() => {
        for (const node of document.querySelectorAll('div.no-print')) {
          if (node.className.includes('border-warning')) node.remove();
        }
      });
      await page.waitForTimeout(1200);
      const png = await page.screenshot({ type: 'png' });
      const file = resolve(outputDir, `${shot.name}-${theme}-${locale}.webp`);
      await sharp(png).resize({ width: shot.width }).webp({ quality: 80, effort: 6 }).toFile(file);
      console.log('captured', file);
      await context.close();
    }
  }
}

await browser.close();
