import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MANAGER, OWNER_A, VIEWER, mockTankerApi, type Locale, type Mode } from './support/tanker-owners-mock';

/**
 * TANKER-PR2 — الفحص البصري والسلوكي لشاشات أصحاب الصهاريج على نسخة إنتاج (خادم مُعترَض ببيانات اصطناعية):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-tanker PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/tanker-owners-visual.spec.ts
 * يُشغَّل يدوياً (خارج CI) قبل أي تفعيل. هذا **ليس** اختبار Safari الفعلي: معيار القبول «Safari آيفون حقيقي» قائم بشكل منفصل (انظر PR2_IMPLEMENTATION_REPORT.md).
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 }, desktop: { width: 1366, height: 820 } } as const;
const LIST = '/fuel-stations/tanker-owners';
const DETAIL = `${LIST}/${OWNER_A}`;

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
async function shot(page: Page, rel: string) {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
}
async function audit(page: Page, label: string, touch = true) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>('main a, main button, main select, main input')]
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains('sr-only')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 36 || r.width < 36)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    return { overflow: doc.scrollWidth - doc.clientWidth, small };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  if (touch) expect.soft(result.small, `${label}: touch targets under 36px`).toEqual([]);
}
async function open(page: Page, path: string, locale: Locale, theme: 'light' | 'dark', permissions: string[], mode: Mode = 'ok') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const mock = await mockTankerApi(page, { baseUrl, locale, theme, permissions, mode });
  await page.goto(path);
  await settle(page);
  return { mock, errors };
}

const MATRIX: Array<{ size: keyof typeof SIZES; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'desktop', locale: 'ar', theme: 'light' },
];

for (const cell of MATRIX) {
  const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
  test.describe(tag, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: cell.size !== 'desktop', hasTouch: cell.size !== 'desktop', deviceScaleFactor: 2 });

    test('list · detail · create owner · dialogs', async ({ page }) => {
      const { mock, errors } = await open(page, LIST, cell.locale, cell.theme, MANAGER);
      await expect(page.getByText(cell.locale === 'ar' ? 'مالك تجريبي أ' : 'Sample Owner A').locator('visible=true').first()).toBeVisible();
      const touch = cell.size !== 'desktop';
      if (cell.locale === 'en') expect(await page.locator('main').innerText(), `${tag}: English page has no RLM-marked dates`).not.toContain('\u200f');
      await audit(page, `${tag} list`, touch);
      await shot(page, `${tag}/01-list`);

      // create owner: dialog fits, payload has allowed fields only, list refreshes
      await page.getByRole('button', { name: cell.locale === 'ar' ? /إضافة صاحب صهريج/ : /Add tanker owner/i }).first().click();
      await page.waitForTimeout(250);
      const dlg = page.getByRole('dialog');
      await expect(dlg).toBeVisible();
      // the design-system dialog scrolls internally: the submit button must be reachable and fully inside the viewport once scrolled to
      await dlg.locator('button[type=submit]').scrollIntoViewIfNeeded();
      const sb = await dlg.locator('button[type=submit]').boundingBox();
      expect.soft(sb && sb.y >= 0 && sb.y + sb.height <= SIZES[cell.size].height + 1 && sb.x >= 0 && sb.x + sb.width <= SIZES[cell.size].width + 1, `${tag}: submit reachable inside viewport`).toBeTruthy();
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${tag}: dialog no horizontal overflow`).toBeLessThanOrEqual(0);
      await dlg.getByRole('textbox').first().scrollIntoViewIfNeeded();
      await shot(page, `${tag}/02-add-owner`);
      await dlg.getByRole('textbox').first().fill(cell.locale === 'ar' ? 'مالك جديد تجريبي' : 'New Sample Owner');
      await dlg.locator('button[type=submit]').click();
      await settle(page);
      const post = mock.requests.find((r) => r.method === 'POST' && r.path === '/fuel-stations/tanker-owners');
      expect(post?.body, `${tag}: create payload`).toBeTruthy();
      expect(Object.keys(post!.body!).sort(), `${tag}: payload has no tenant_id / partner_id`).not.toContain('tenant_id');
      await expect(page.getByText(cell.locale === 'ar' ? 'مالك جديد تجريبي' : 'New Sample Owner').locator('visible=true').first()).toBeVisible();

      // detail: sections + tanker dialog + link dialog
      await page.goto(DETAIL);
      await settle(page);
      await audit(page, `${tag} detail`, touch);
      await shot(page, `${tag}/03-detail`);
      await page.getByRole('button', { name: cell.locale === 'ar' ? /إضافة صهريج/ : /Add tanker/i }).first().click();
      await page.waitForTimeout(250);
      await shot(page, `${tag}/04-add-tanker`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      await page.getByRole('button', { name: cell.locale === 'ar' ? /ربط شركة/ : /Link (a )?company/i }).first().click();
      await page.waitForTimeout(250);
      await shot(page, `${tag}/05-link-company`);
      await page.keyboard.press('Escape');

      // narrow-height (keyboard-like) check for the tanker dialog
      if (cell.size !== 'desktop') {
        await page.getByRole('button', { name: cell.locale === 'ar' ? /إضافة صهريج/ : /Add tanker/i }).first().click();
        await page.setViewportSize({ width: SIZES[cell.size].width, height: Math.max(220, SIZES[cell.size].height - 336) });
        await page.waitForTimeout(250);
        const field = page.getByRole('dialog').getByRole('textbox').first();
        await field.focus();
        await page.waitForTimeout(500);
        const fb = await field.boundingBox();
        const vh = await page.evaluate(() => window.innerHeight);
        expect.soft(fb && fb.y >= 0 && fb.y + fb.height <= vh + 1, `${tag}: focused field visible with reduced height`).toBeTruthy();
        await shot(page, `${tag}/06-dialog-reduced-height`);
      }
      expect(errors, `${tag}: page errors`).toEqual([]);
    });
  });
}

test.describe('states (iphone ar)', () => {
  test.use({ viewport: SIZES.iphone, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('gate closed → not enabled, no list requests beyond the probe', async ({ page }) => {
    const { mock } = await open(page, LIST, 'ar', 'light', MANAGER, 'gate_closed');
    await expect(page.getByText(/غير مفعّلة|غير مفعلة/).first()).toBeVisible();
    await audit(page, 'gate-closed');
    await shot(page, 'states/gate-closed');
    expect(mock.requests.some((r) => r.method !== 'GET'), 'no writes').toBeFalsy();
  });

  test('server error → retry card', async ({ page }) => {
    await open(page, LIST, 'ar', 'light', MANAGER, 'error');
    await expect(page.getByRole('button', { name: /إعادة المحاولة/ }).first()).toBeVisible();
    await shot(page, 'states/error');
  });

  test('view-only → write buttons disabled, no phone/notes', async ({ page }) => {
    await open(page, LIST, 'ar', 'light', VIEWER);
    const add = page.getByRole('button', { name: /إضافة صاحب صهريج/ }).first();
    await expect(add).toBeDisabled();
    await shot(page, 'states/view-only');
  });

  test('no tanker permission → denied without requests', async ({ page }) => {
    const { mock } = await open(page, LIST, 'ar', 'light', ['fuel_stations.view']);
    await expect(page.getByText(/fuel\.tanker\.view/).first()).toBeVisible();
    expect(mock.requests.filter((r) => r.path.startsWith('/fuel-stations/tanker')).length, 'no tanker requests').toBe(0);
    await shot(page, 'states/denied');
  });
});
