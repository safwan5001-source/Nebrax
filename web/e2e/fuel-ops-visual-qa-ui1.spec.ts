import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mockOpsApi, type Locale, type Scenario } from './support/fuel-ops-ui1-mock';

/**
 * FUEL-OPS UI-1 — الفحص البصري لشاشتَي «تفاصيل الوردية» و«قائمة الورديات» والرئيسية بعد ربطها. يُشغَّل على نسخة إنتاج:
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-ui1 VQA_REFERENCE_HTML=<مسار المرجع> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 \
 *     npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-visual-qa-ui1.spec.ts
 * ينتج لقطات صفحة كاملة لمصفوفة (شاشة × مقاس × ثيم × لغة) وحالات البيانات، ولقطات المرجع المعتمد بالمقاسات نفسها، ويفحص آلياً: التجاوز الأفقي،
 * أهداف اللمس، تغطية التنقل السفلي، النصوص المقصوصة، خط الحقول، ودجت Next، أخطاء الكونسول. الحكم البصري يكتبه المراجع في VISUAL_QA_REPORT_UI_1.md.
 * الخادم مُعترَض؛ الأسماء بيانات اختبار موسومة.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const REFERENCE = process.env.VQA_REFERENCE_HTML;
test.skip(!OUT, 'VQA_OUT is required');

const VIEWPORTS = [{ w: 320, h: 568 }, { w: 375, h: 812 }, { w: 390, h: 844 }, { w: 414, h: 896 }, { w: 430, h: 932 }] as const;
const SCREENS: Array<[string, string]> = [['home', ''], ['list', '/shifts'], ['detail-open', '/shifts/h1'], ['detail-closed', '/shifts/h2'], ['detail-closed-expanded', '/shifts/h2'], ['detail-approved', '/shifts/h3']];

const findings: Array<Record<string, unknown>> = [];

async function settle(page: import('@playwright/test').Page, scenario: Scenario = 'default') {
  await page.locator('#fo-main').waitFor({ state: 'attached' });
  if (scenario === 'loading') await page.waitForTimeout(800);
  else await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function shot(page: import('@playwright/test').Page, rel: string, fullPage = true) {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage });
}

test.describe('matrix: screens × viewports × theme × locale', () => {
  for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) for (const vp of VIEWPORTS) for (const [name, path] of SCREENS) {
    test(`${name} ${locale} ${theme} ${vp.w}x${vp.h}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w === 390 ? 2 : 1, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const mock = await mockOpsApi(page, { baseUrl, locale, theme });
      await page.goto(`${baseUrl}/fuel-stations/ops${path}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      if (name.endsWith('-expanded')) { await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => d.setAttribute('open', ''))); await page.waitForTimeout(200); }
      await shot(page, `matrix/${name}-${locale}-${theme}-${vp.w}x${vp.h}`);

      const m = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label]') as HTMLElement;
        const main = document.querySelector('#fo-main') as HTMLElement;
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const small: string[] = [];
        for (const el of document.querySelectorAll('nav a, header a, header select, main a, main button, main select, main summary')) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const clipped: string[] = [];
        const tiny = new Set<string>();
        for (const el of main.querySelectorAll('*')) {
          const h = el as HTMLElement;
          const style = getComputedStyle(h);
          if (h.scrollWidth > h.clientWidth + 1 && style.overflowX !== 'visible' && h.clientWidth > 0) clipped.push(`${h.tagName.toLowerCase()}:${(h.textContent || '').trim().slice(0, 30)}`);
          const own = [...h.childNodes].some((c) => c.nodeType === 3 && (c.textContent || '').trim().length > 0);
          if (own && parseFloat(style.fontSize) < 11.5) tiny.add(`${parseFloat(style.fontSize)}px`);
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
        const lastBottom = Math.max(...[...main.querySelectorAll('*')].filter((e) => !e.closest('details:not([open])') || e.tagName === 'SUMMARY').map((e) => (e as HTMLElement).getBoundingClientRect().bottom));
        const field = document.querySelector('select');
        return {
          overflow, small, clipped, tiny: [...tiny], clearance: Math.round(nav.getBoundingClientRect().top - lastBottom), pageHeight: document.documentElement.scrollHeight,
          fieldFont: field ? parseFloat(getComputedStyle(field).fontSize) : null, devtools: !!document.querySelector('nextjs-portal, [data-nextjs-toast]'),
          dir: document.documentElement.dir, dark: document.documentElement.classList.contains('dark'),
          arabicIndicDigits: /[٠-٩۰-۹]/.test(main.innerText),
        };
      });
      findings.push({ id: `${name}-${locale}-${theme}-${vp.w}`, ...m, issues: mock.issues, writes: mock.requests.filter((r) => r.method !== 'GET').length });
      if (vp.w === 320 || vp.w === 390) { await shot(page, `scrolled-bottom/${name}-${locale}-${theme}-${vp.w}x${vp.h}`, false); }
      expect(m.overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
      expect(m.small, 'touch targets under 44px').toEqual([]);
      expect(m.clipped, 'clipped text').toEqual([]);
      expect(m.devtools).toBe(false);
      expect(m.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(m.dark).toBe(theme === 'dark');
      expect(m.arabicIndicDigits, 'Latin digits only').toBe(false);
      expect(m.clearance, 'last content must clear the bottom navigation').toBeGreaterThanOrEqual(0);
      expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([]);
      expect(mock.issues).toEqual([]);
      const hrefs = await page.locator('a').evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
      expect(hrefs.filter((href) => !href.startsWith('#') && !href.startsWith('/fuel-stations/ops')), 'links leaving the app').toEqual([]);
      await context.close();
    });
  }
});

test.describe('states (390x844)', () => {
  const states: Array<[Scenario, string, string]> = [
    ['default', '/shifts/h1', 'open-partial'], ['no-readings', '/shifts/h1', 'open-no-readings'], ['default', '/shifts/h2', 'closed'], ['default', '/shifts/h3', 'approved'],
    ['anomalies', '/shifts/h2', 'mismatch-and-invalid'], ['no-timezone', '/shifts/h2', 'no-timezone'], ['loading', '/shifts/h2', 'loading'], ['not-found', '/shifts/h2', 'not-found'],
    ['forbidden', '/shifts/h2', 'forbidden'], ['server-error', '/shifts/h2', 'server-error'], ['offline', '/shifts/h2', 'offline'], ['no-permission', '/shifts/h1', 'no-permission'],
    ['refresh-fails', '/shifts/h2', 'refresh-failed-stale'],
  ];
  for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) for (const [scenario, path, name] of states) {
    if (theme === 'dark' && !['open-partial', 'closed', 'mismatch-and-invalid', 'not-found', 'refresh-failed-stale'].includes(name)) continue;
    test(`${name} ${locale} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const mock = await mockOpsApi(page, { baseUrl, locale, theme, scenario });
      await page.goto(`${baseUrl}/fuel-stations/ops${path}`, { waitUntil: 'domcontentloaded' });
      await settle(page, scenario);
      if (scenario === 'refresh-fails') {
        mock.controls.failDetail = true;
        await page.getByRole('button', { name: locale === 'ar' ? 'تحديث' : 'Refresh' }).click();
        await page.waitForTimeout(700);
      }
      await shot(page, `states/${name}-${locale}-${theme}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([]);
      await context.close();
    });
  }
});

test('reference prototype captures (same viewports)', async ({ browser }) => {
  test.skip(!REFERENCE, 'VQA_REFERENCE_HTML not provided');
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w === 390 ? 2 : 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(`file://${REFERENCE}`);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(800);
    for (const id of ['meters', 'shifts']) {
      await page.evaluate((x) => (window as unknown as { go: (i: string) => void }).go(x), id);
      await page.waitForTimeout(150);
      await shot(page, `reference/${id}-ar-light-${vp.w}x${vp.h}`);
    }
    await context.close();
  }
});

test.afterAll(() => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'findings-ui1.json'), JSON.stringify(findings, null, 2));
});
