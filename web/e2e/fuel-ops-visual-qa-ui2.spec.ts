import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockUi2Api, type Locale, type Seed } from './support/fuel-ops-ui2-mock';

/**
 * FUEL-OPS UI-2 — الفحص البصري لشاشات الكتابة (فتح الوردية، إدخال القراءات، التسليم) على نسخة إنتاج:
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-ui2 VQA_REFERENCE_HTML=<مسار المرجع> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 \
 *     npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-visual-qa-ui2.spec.ts
 * ينتج لقطات صفحة كاملة لمصفوفة (حالة × مقاس × ثيم × لغة) + لقطتَي المرجع المعتمد (قراءات المضخات، تسليم الفترة) بالمقاسين نفسيهما، ويفحص آلياً:
 * التجاوز الأفقي، أهداف اللمس، خط الحقول، النصوص المقصوصة، تغطية شريط الإجراء بالتنقل السفلي، الأرقام الهندية، روابط خارج التطبيق، أي POST خارج
 * القائمة البيضاء، أخطاء الكونسول. الحكم البصري يكتبه المراجع في VISUAL_QA_REPORT_UI_2.md بعد فتح اللقطات. الخادم مُعترَض ببيانات اختبار موسومة.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const REFERENCE = process.env.VQA_REFERENCE_HTML;
test.skip(!OUT, 'VQA_OUT is required');

const WHITELIST = /^\/fuel-stations\/shifts\/(open|[\w-]+\/(staff|meter-readings|tank-readings|cash-movements|close))$/;
const STATES = [
  'home-open-fresh', 'open-form', 'open-form-filled', 'open-confirm', 'open-success',
  'entry-opening-empty', 'entry-opening-filled', 'entry-opening-review', 'entry-closing-blocked', 'entry-opening-done',
  'handover-incomplete', 'handover-ready', 'handover-confirm', 'handover-done',
  'state-lost-reply', 'state-rejected',
] as const;
type State = (typeof STATES)[number];

const SEED: Record<State, Seed> = {
  'home-open-fresh': 'open-fresh', 'open-form': 'none', 'open-form-filled': 'none', 'open-confirm': 'none', 'open-success': 'none',
  'entry-opening-empty': 'open-fresh', 'entry-opening-filled': 'open-fresh', 'entry-opening-review': 'open-fresh', 'entry-closing-blocked': 'open-opened', 'entry-opening-done': 'open-fresh',
  'handover-incomplete': 'open-opened', 'handover-ready': 'ready', 'handover-confirm': 'ready', 'handover-done': 'ready',
  'state-lost-reply': 'none', 'state-rejected': 'ready',
};
const START: Record<State, string> = {
  'home-open-fresh': '', 'open-form': '/shifts/open', 'open-form-filled': '/shifts/open', 'open-confirm': '/shifts/open', 'open-success': '/shifts/open',
  'entry-opening-empty': '/shifts/s-open/readings/opening', 'entry-opening-filled': '/shifts/s-open/readings/opening', 'entry-opening-review': '/shifts/s-open/readings/opening',
  'entry-closing-blocked': '/shifts/s-open/readings/closing', 'entry-opening-done': '/shifts/s-open/readings/opening',
  'handover-incomplete': '/shifts/s-open/handover', 'handover-ready': '/shifts/s-open/handover', 'handover-confirm': '/shifts/s-open/handover', 'handover-done': '/shifts/s-open/handover',
  'state-lost-reply': '/shifts/open', 'state-rejected': '/shifts/s-open/handover',
};

const findings: Array<Record<string, unknown>> = [];

async function settle(page: Page) {
  await page.locator('#fo-main').waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);
}

async function shot(page: Page, rel: string, fullPage = true) {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage });
}

/** يقود الشاشة إلى الحالة المطلوبة بالتفاعل الحقيقي (لا حقن حالة): كل لقطة هي ما يراه الموظف فعلاً. */
async function reach(page: Page, state: State, mock: Awaited<ReturnType<typeof mockUi2Api>>) {
  const inputs = page.locator('[data-entry-input]');
  const fillOpening = async (count: number, offset = 0) => {
    for (let i = 0; i < count; i += 1) await inputs.nth(i).fill(String(125_430 + i * 13_700 + i * 0.25 + offset));
  };
  switch (state) {
    case 'open-form-filled':
    case 'open-confirm':
    case 'open-success':
    case 'state-lost-reply':
      await page.getByTestId('open-float').fill('500');
      if (state === 'state-lost-reply') mock.controls.fault = { match: /\/open$/, mode: 'lost_reply', times: 1 };
      if (state !== 'open-form-filled') {
        await page.locator('main button[data-primary-action]').click();
        await page.getByRole('dialog').waitFor();
      }
      if (state === 'open-success' || state === 'state-lost-reply') {
        await page.locator('[data-confirm-open]').click();
        await page.waitForSelector(state === 'open-success' ? '[data-open-success]' : '[data-write-notice]');
        if (state === 'open-success') await page.waitForTimeout(400);
      }
      break;
    case 'entry-opening-empty':
      await inputs.first().waitFor();
      break;
    case 'entry-opening-filled':
    case 'entry-opening-review':
    case 'entry-opening-done':
      await inputs.first().waitFor();
      await fillOpening(6, state === 'entry-opening-filled' ? 3 : 0); // أول إدخال يختلف عن آخر إغلاق ⇒ تنبيه ناعم
      for (let i = 0; i < 3; i += 1) await inputs.nth(6 + i).fill(String(24_000 - i * 1_000));
      if (state !== 'entry-opening-filled') {
        await page.locator('[data-action-bar] button').click();
        await page.getByRole('dialog').waitFor();
        if (state === 'entry-opening-done') {
          const ack = page.getByRole('dialog').getByRole('checkbox');
          if (await ack.count()) await ack.check();
          await page.locator('[data-confirm-save]').click();
          await page.waitForSelector('[data-entry-complete]');
        }
      }
      break;
    case 'entry-closing-blocked':
      await inputs.first().waitFor();
      await inputs.first().fill('1');
      await inputs.nth(1).fill('140000');
      break;
    case 'handover-ready':
    case 'handover-confirm':
    case 'handover-done':
    case 'state-rejected':
      await page.getByTestId('counted-cash').fill('480');
      if (state === 'state-rejected') mock.controls.fault = { match: /\/close$/, mode: 'reject', message: 'سياسة المحطة تتطلب إسناد عامل واحد على الأقل قبل إغلاق الشفت.', times: 1 };
      if (state !== 'handover-ready') {
        await page.locator('[data-action-bar] button').click();
        await page.getByRole('dialog').waitFor();
        if (state !== 'handover-confirm') {
          await page.locator('[data-confirm-ack]').check();
          await page.locator('[data-confirm-close]').click();
          await page.waitForSelector(state === 'handover-done' ? '[data-handover-done]' : '[data-write-notice]');
        }
      }
      break;
    default:
      break;
  }
  await page.waitForTimeout(250);
}

async function probe(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('#fo-main') as HTMLElement;
    const nav = document.querySelector('nav[aria-label]') as HTMLElement;
    const small: string[] = [];
    for (const el of document.querySelectorAll('nav a, header a, header select, main a, main button, main select, main summary, [role=dialog] button, [role=dialog] label:has(input[type=checkbox]), [role=dialog] label:has(input[type=radio])')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const clipped: string[] = [];
    const tiny = new Set<string>();
    for (const el of main.querySelectorAll('*')) {
      const h = el as HTMLElement;
      const style = getComputedStyle(h);
      if (h.scrollWidth > h.clientWidth + 1 && style.overflowX !== 'visible' && h.clientWidth > 0 && !h.matches('input, textarea')) clipped.push(`${h.tagName.toLowerCase()}:${(h.textContent || '').trim().slice(0, 30)}`);
      const own = [...h.childNodes].some((c) => c.nodeType === 3 && (c.textContent || '').trim().length > 0);
      if (own && parseFloat(style.fontSize) < 11.5) tiny.add(`${parseFloat(style.fontSize)}px`);
    }
    const fields = [...document.querySelectorAll('main input[type=text], main textarea, [role=dialog] input[type=text], [role=dialog] textarea')].map((el) => parseFloat(getComputedStyle(el).fontSize));
    const bar = document.querySelector('[data-action-bar]') as HTMLElement | null;
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '').filter((h) => h && !h.startsWith('#') && !h.startsWith('/fuel-stations/ops'));
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small, clipped, tiny: [...tiny], minFieldFont: fields.length ? Math.min(...fields) : null,
      barOverlapsNav: bar && nav ? Math.round(bar.getBoundingClientRect().bottom - nav.getBoundingClientRect().top) : null,
      devtools: !!document.querySelector('nextjs-portal, [data-nextjs-toast]'),
      dir: document.documentElement.dir, dark: document.documentElement.classList.contains('dark'),
      arabicIndicDigits: /[٠-٩۰-۹]/.test((document.body as HTMLElement).innerText),
      outsideLinks: hrefs, pageHeight: document.documentElement.scrollHeight,
    };
  });
}

const FULL: Array<{ w: number; h: number; locales: Locale[]; themes: Array<'light' | 'dark'> }> = [
  { w: 390, h: 844, locales: ['ar', 'en'], themes: ['light', 'dark'] },
  { w: 320, h: 568, locales: ['ar', 'en'], themes: ['light'] },
  { w: 430, h: 932, locales: ['ar', 'en'], themes: ['light'] },
];

test.describe('matrix: states × viewports × theme × locale', () => {
  for (const vp of FULL) for (const locale of vp.locales) for (const theme of vp.themes) for (const state of STATES) {
    test(`${state} ${locale} ${theme} ${vp.w}x${vp.h}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w === 390 ? 2 : 1, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const mock = await mockUi2Api(page, { baseUrl, locale, theme, seed: SEED[state] });
      await page.goto(`${baseUrl}/fuel-stations/ops${START[state]}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await reach(page, state, mock);
      await shot(page, `matrix/${state}-${locale}-${theme}-${vp.w}x${vp.h}`);
      const m = await probe(page);
      const badPosts = mock.posts.filter((p) => !WHITELIST.test(p.path)).map((p) => p.path);
      findings.push({ id: `${state}-${locale}-${theme}-${vp.w}`, ...m, issues: mock.issues, posts: mock.posts.length, badPosts });
      if (vp.w === 390 || vp.w === 320) await shot(page, `viewport/${state}-${locale}-${theme}-${vp.w}x${vp.h}`, false);
      expect(m.overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
      expect(m.small, 'touch targets < 44px').toEqual([]);
      expect(m.clipped, 'clipped text').toEqual([]);
      expect(m.outsideLinks, 'links leaving the app').toEqual([]);
      expect(badPosts, 'POST outside the whitelist').toEqual([]);
      expect(m.devtools).toBe(false);
      expect(m.arabicIndicDigits, 'Arabic-Indic digits').toBe(false);
      if (m.minFieldFont !== null) expect(m.minFieldFont).toBeGreaterThanOrEqual(16);
      if (m.barOverlapsNav !== null) expect(m.barOverlapsNav, 'action bar overlaps the bottom nav').toBeLessThanOrEqual(1);
      expect(mock.issues).toEqual([]);
      await context.close();
    });
  }
});

test('reference prototype captures (same viewports)', async ({ browser }) => {
  test.skip(!REFERENCE, 'VQA_REFERENCE_HTML not provided');
  for (const vp of [{ w: 320, h: 568 }, { w: 390, h: 844 }]) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w === 390 ? 2 : 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    for (const id of ['meters', 'handover']) {
      await page.goto(`file://${REFERENCE}`);
      await page.evaluate((target) => (window as unknown as { go: (id: string) => void }).go(target), id);
      await page.waitForTimeout(300);
      await shot(page, `reference/${id}-ar-light-${vp.w}x${vp.h}`);
    }
    await context.close();
  }
});

test.afterAll(() => {
  if (!OUT || findings.length === 0) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'automated-findings-ui2.json'), JSON.stringify(findings, null, 2));
});
