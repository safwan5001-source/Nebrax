import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockUi2Api, type Locale } from './support/fuel-ops-ui2-mock';

/**
 * TANK-LEVEL-P2 — الفحص البصري لبطاقات الخزانات بعد ربط مؤشر الرصيد الدفتري، على نسخة إنتاج:
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-tank PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 \
 *     npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-tank-level-visual.spec.ts
 * الخادم مُعترَض (لا خلفية): يعيد `mockUi2Api` الجلسة والمحطة، ويُستبدَل مسار الخزانات وحده ببطاقات تغطي كل الحالات.
 * المتصفح Chromium بمحاكاة مقاس iPhone — **ليس Safari/WebKit الحقيقي**؛ التحقق على الجهاز الفعلي بند يدوي منفصل.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const CAP = 34_000_000;
const book = (ml: number) => ({ book_level: { milliliters: ml, basis: 'warehouse_book', as_of: null }, book_level_unavailable_reason: null });
const none = (reason: string) => ({ book_level: null, book_level_unavailable_reason: reason });

function tankRows(locale: Locale) {
  const ar = locale === 'ar';
  const base = (i: number, name: string, extra: Record<string, unknown>) => ({
    id: `tk${i}`, fuel_station_id: 'sa', fuel_product_id: `p${(i % 3) + 1}`, code: `TK${i}`, name, capacity_milliliters: CAP, minimum_level_milliliters: null, status: 'active', ...extra,
  });
  return [
    base(1, ar ? 'خزان جيد' : 'Tank good', book(18_700_000)),
    base(2, ar ? 'خزان متابعة' : 'Tank monitor', book(11_900_000)),
    base(3, ar ? 'خزان منخفض' : 'Tank low', book(4_760_000)),
    base(4, ar ? 'خزان فارغ' : 'Tank empty', book(0)),
    base(5, ar ? 'خزان شاذ' : 'Tank over', book(36_000_000)),
    base(6, ar ? 'خزان متعدد' : 'Tank multi', none('multi_tank')),
    base(7, ar ? 'خزان بلا سجل' : 'Tank no record', none('no_stock_record')),
    base(8, ar ? 'خزان خادم قديم' : 'Tank old server', {}),
    base(9, ar ? 'خزان فاسد' : 'Tank corrupt', { book_level: { milliliters: 'x', basis: 'warehouse_book', as_of: null }, book_level_unavailable_reason: null }),
    base(10, ar ? 'خزان تحت الحد' : 'Tank min alert', { ...book(4_000_000), minimum_level_milliliters: 5_000_000 }),
    base(11, ar ? 'خزان 20 بالضبط' : 'Tank exactly 20', book(6_800_000)),
    base(12, ar ? 'خزان 50 بالضبط' : 'Tank exactly 50', book(17_000_000)),
  ];
}

async function probe(page: Page) {
  return page.evaluate(() => {
    const small: string[] = [];
    for (const el of document.querySelectorAll('nav a, header a, header select, main a, main button, main select, main summary')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const section = document.querySelector('#fo-tanks-h')?.closest('section') as HTMLElement | null;
    // الاقتصاص يُفحص داخل المؤشر وحده؛ عنوان البطاقة القائم (`truncate`) خارج نطاق هذا التغيير ويُسجَّل عدّه منفصلاً.
    const clipped: string[] = [];
    const titleTruncated = [...(section?.querySelectorAll('li > div > p.truncate') ?? [])].filter((p) => (p as HTMLElement).scrollWidth > (p as HTMLElement).clientWidth + 1).length;
    for (const el of section?.querySelectorAll('[data-tank-level], [data-tank-level] *') ?? []) {
      const h = el as HTMLElement;
      if (h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflowX !== 'visible' && h.clientWidth > 0 && !h.matches('[role=meter]')) clipped.push(`${h.tagName.toLowerCase()}:${(h.textContent || '').trim().slice(0, 30)}`);
    }
    const nav = document.querySelector('nav[aria-label]') as HTMLElement | null;
    const meters = [...document.querySelectorAll('[role=meter]')].map((m) => {
      const fill = m.firstElementChild as HTMLElement;
      const track = m as HTMLElement;
      const fr = fill.getBoundingClientRect();
      const tr = track.getBoundingClientRect();
      const cs = getComputedStyle(fill);
      return { text: m.getAttribute('aria-valuetext') ?? '', band: m.closest('[data-band]')?.getAttribute('data-band'), fillBg: cs.backgroundColor, fillWidthPx: Math.round(fr.width * 10) / 10, trackWidthPx: Math.round(tr.width * 10) / 10,
        fillStartsAtInlineStart: document.documentElement.dir === 'rtl' ? Math.abs(fr.right - (tr.right - 1)) <= 2 : Math.abs(fr.left - (tr.left + 1)) <= 2, transition: cs.transitionDuration };
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small, clipped, titleTruncated, meters, dir: document.documentElement.dir, dark: document.documentElement.classList.contains('dark'),
      arabicIndicDigits: /[٠-٩۰-۹]/.test((document.body as HTMLElement).innerText),
      lastCardBottomVsNavTop: nav && section ? Math.round(section.getBoundingClientRect().bottom + window.scrollY - nav.getBoundingClientRect().top - window.scrollY) : null,
      devtools: !!document.querySelector('nextjs-portal, [data-nextjs-toast]'),
      statuses: [...document.querySelectorAll('[data-tank-level]')].map((n) => `${n.getAttribute('data-tank-level')}:${n.getAttribute('data-band') ?? n.getAttribute('data-reason') ?? ''}`),
      minAlerts: document.querySelectorAll('[data-minimum-alert]').length,
      pageHeight: document.documentElement.scrollHeight,
    };
  });
}

const findings: Array<Record<string, unknown>> = [];
const VIEWPORTS = [{ w: 390, h: 844 }, { w: 320, h: 568 }, { w: 430, h: 932 }];

for (const vp of VIEWPORTS) for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
  if (vp.w !== 390 && theme === 'dark') continue;
  test(`tank cards ${locale} ${theme} ${vp.w}x${vp.h}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w === 390 ? 2 : 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const mock = await mockUi2Api(page, { baseUrl, locale, theme });
    // المسار الأحدث تسجيلاً يُطابَق أولاً: يستبدل الخزانات فقط.
    await page.route('**/api/fuel-stations/tanks', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: tankRows(locale) }) }));
    await page.goto(`${baseUrl}/fuel-stations/ops/products`, { waitUntil: 'domcontentloaded' });
    await page.locator('#fo-tanks-h').waitFor();
    await page.locator('[data-tank-level]').first().waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    mkdirSync(join(OUT!, 'tank-level'), { recursive: true });
    const name = `${locale}-${theme}-${vp.w}x${vp.h}`;
    await page.locator('#fo-tanks-h').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT!, 'tank-level', `${name}-viewport.png`), fullPage: false });
    await page.locator('#fo-tanks-h').locator('xpath=ancestor::section[1]').screenshot({ path: join(OUT!, 'tank-level', `${name}-tanks.png`) });

    const m = await probe(page);
    findings.push({ id: name, ...m, issues: mock.issues, writes: mock.posts.length });

    expect(m.overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
    expect(m.small, 'touch targets < 44px').toEqual([]);
    expect(m.clipped, 'clipped text').toEqual([]);
    expect(m.devtools).toBe(false);
    expect(m.arabicIndicDigits, 'Arabic-Indic digits').toBe(false);
    expect(m.dark).toBe(theme === 'dark');
    expect(m.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(m.meters.length).toBe(7);                                  // good, monitor, low, empty, below-minimum, exactly 20%, exactly 50%
    expect(m.statuses.filter((s) => s.startsWith('ok:')).length).toBe(7);
    expect(m.statuses.filter((s) => s.startsWith('over_capacity')).length).toBe(1);
    expect(m.statuses.filter((s) => s.startsWith('unavailable')).length).toBe(4);
    expect(m.minAlerts).toBe(1);
    for (const meter of m.meters) {
      expect(meter.fillStartsAtInlineStart, `fill starts at the inline start: ${meter.text}`).toBe(true);
      expect(meter.transition, 'no transition').toMatch(/^0s(, 0s)*$/);
    }
    expect(mock.posts, 'no write request at all').toEqual([]);
    expect(mock.issues).toEqual([]);
    await context.close();
  });
}

test.afterAll(() => {
  if (!OUT || findings.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'tank-level-findings.json'), JSON.stringify(findings, null, 2));
});
