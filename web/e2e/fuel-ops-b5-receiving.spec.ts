import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { APPROVER, CREATOR, DRAFT_ID, SELLER, mockB5Api, type Locale } from './support/fuel-ops-b5-mock';

/**
 * FUEL-B5 — الفحص البصري والسلوكي لاستلام الوقود على نسخة إنتاج (خادم مُعترَض ببيانات اختبار موسومة):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-b5 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-b5-receiving.spec.ts
 * لقطات: الحالة × المقاس (iPhone 390×844، iPhone SE 320×568) × الثيم × اللغة. فحوص آلية: التجاوز الأفقي، تغطية شريط الإجراء بالتنقل السفلي، أخطاء الكونسول،
 * وأن كل كتابة هي POST على مسارات الاستلام الثلاثة فقط. الحكم البصري يكتبه المراجع بعد فتح اللقطات.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
type SizeKey = keyof typeof SIZES;
const RCV = '/fuel-stations/ops/receiving';
const WRITE = /^\/fuel-stations\/(readings|deliveries|deliveries\/[0-9a-f-]{36}\/approve)$/;

async function settle(page: Page) {
  await page.locator('#fo-main').waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function shot(page: Page, rel: string) {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
}

async function audit(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>('main a, main button, main [role="radio"], main input, main textarea, [role="dialog"] button, nav a')]
      .filter((el) => el.getClientRects().length > 0).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 40 || r.width < 40)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    const bar = document.querySelector('[data-action-bar]')?.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label]')?.getBoundingClientRect();
    const navItems = document.querySelectorAll('nav[aria-label] li').length;
    return { overflow: doc.scrollWidth - doc.clientWidth, small, barOverlapsNav: bar && nav ? bar.bottom > nav.top + 1 : false, navItems };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.barOverlapsNav, `${label}: action bar overlaps bottom nav`).toBe(false);
  if (result.small.length > 0) test.info().annotations.push({ type: 'small-targets', description: `${label}: ${result.small.join(' | ')}` });
}

const MATRIX: Array<{ size: SizeKey; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'se', locale: 'en', theme: 'light' },
];

for (const cell of MATRIX) {
  test.describe(`${cell.size}-${cell.locale}-${cell.theme}`, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const tag = `${cell.size}-${cell.locale}-${cell.theme}`;

    test('creator: list · wizard · draft saved', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockB5Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: CREATOR, canSeeCost: true });
      const at = (name: string) => `${tag}/creator/${name}`;
      const n = mock.names;

      await page.goto(`${baseUrl}${RCV}`);
      await settle(page);
      await shot(page, at('01-list'));
      await audit(page, `${tag} list`);

      await page.goto(`${baseUrl}${RCV}/new`);
      await settle(page);
      await page.getByRole('radio', { name: new RegExp(n.suppliers[0]) }).click();
      await page.getByRole('radio', { name: new RegExp(n.tanks[0]) }).click();
      await page.locator('#rcv-note').fill('DN-FX-200');
      await shot(page, at('02-step1'));
      await audit(page, `${tag} step1`);
      await page.locator('[data-next-step]').click();
      await page.getByTestId('rcv-dispatched').fill('10000');
      await page.getByTestId('rcv-received').fill('9950');
      await page.getByTestId('rcv-cost').fill('12500.50');
      await shot(page, at('03-step2'));
      await audit(page, `${tag} step2`);
      await page.locator('[data-next-step]').click();
      await page.getByTestId('rcv-before').fill('1200');
      await page.getByTestId('rcv-after').fill('11200');
      await shot(page, at('04-step3'));
      await audit(page, `${tag} step3`);
      await page.locator('[data-next-step]').click();
      await shot(page, at('05-review'));
      await audit(page, `${tag} review`);
      await page.locator('[data-save-draft]').click();
      await page.locator('[data-created]').waitFor();
      await shot(page, at('06-created'));

      const writes = mock.requests.filter((r) => r.method !== 'GET');
      expect(writes.every((r) => r.method === 'POST' && WRITE.test(r.path)), JSON.stringify(writes)).toBe(true);
      expect(mock.posts.some((p) => p.path.endsWith('/approve'))).toBe(false);
      expect(mock.issues).toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  });

  test.describe(`${cell.size}-${cell.locale}-${cell.theme} approver`, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const tag = `${cell.size}-${cell.locale}-${cell.theme}`;

    test('approver: detail · confirm · distinct-approver refusal · approved', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockB5Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: APPROVER, canSeeCost: false });
      const at = (name: string) => `${tag}/approver/${name}`;

      await page.goto(`${baseUrl}${RCV}/${DRAFT_ID}`);
      await settle(page);
      await shot(page, at('01-detail-draft'));
      await audit(page, `${tag} detail`);
      expect(await page.locator('body').innerText()).not.toMatch(/12,500|1250000|12500/); // لا تكلفة لمن لا يملكها

      await page.locator('[data-approve-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(250);
      await shot(page, at('02-confirm'));
      await audit(page, `${tag} confirm`);
      mock.controls.distinctApprover = true;
      await page.locator('[data-confirm-approve]').click();
      await page.locator('[data-failure="rejected"]').waitFor();
      await shot(page, at('03-distinct-refusal'));
      await audit(page, `${tag} refusal`);

      await page.locator('[data-approve-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.locator('[data-confirm-approve]').click();
      await page.locator('[data-approved-success]').waitFor();
      await shot(page, at('04-approved'));

      const writes = mock.requests.filter((r) => r.method !== 'GET');
      expect(writes.every((r) => r.method === 'POST' && WRITE.test(r.path)), JSON.stringify(writes)).toBe(true);
      expect(writes.filter((r) => r.path.endsWith('/approve'))).toHaveLength(2); // الرفض ثم النجاح، لا غيرهما
      expect(mock.issues).toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  });
}

test.describe('no access', () => {
  test.use({ viewport: SIZES.iphone, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('a seller has no Receiving entry and the screen is an honest forbidden state', async ({ page }) => {
    const mock = await mockB5Api(page, { baseUrl, locale: 'ar', theme: 'light', permissions: SELLER, canSeeCost: false });
    await page.goto(`${baseUrl}/fuel-stations/ops`);
    await settle(page);
    await expect(page.locator('nav[aria-label] a[href$="/receiving"]')).toHaveCount(0);
    await page.goto(`${baseUrl}${RCV}`);
    await settle(page);
    await shot(page, 'seller/01-forbidden');
    expect(mock.requests.filter((r) => r.path.includes('/fuel-stations/deliveries') || r.path.includes('delivery-suppliers'))).toEqual([]);
  });
});
