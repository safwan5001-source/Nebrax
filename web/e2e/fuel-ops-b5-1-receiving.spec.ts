import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { APPROVER, COSTED_ID, CREATOR, DRAFT_ID, FINANCE, SELLER, mockB5Api, type Locale } from './support/fuel-ops-b5-mock';

/**
 * FUEL-B5.1 — الفحص البصري والسلوكي لاستلام الوقود (مسودة بلا تكلفة · مرفقات السند · استكمال التكلفة · الاعتماد · الطباعة والتصدير) على نسخة إنتاج
 * (خادم مُعترَض ببيانات اختبار موسومة، لا خلفية ولا بيانات حقيقية):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-b51 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-b5-1-receiving.spec.ts
 * لقطات: الحالة × المقاس (iPhone 390×844، iPhone SE 320×568) × الثيم × اللغة. فحوص آلية: التجاوز الأفقي، تغطية شريط الإجراء بالتنقل السفلي، أهداف اللمس،
 * وأن كل كتابة على مسارات الاستلام المعلنة فقط، وأن موظف المحطة لا يرى مبلغاً في أي سطح (DOM/لقطة/طلب).
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
type SizeKey = keyof typeof SIZES;
const RCV = '/fuel-stations/ops/receiving';
const WRITE = /^\/fuel-stations\/(readings|deliveries|deliveries\/[0-9a-f-]{36}\/(approve|cost|attachments|attachments\/[0-9a-f-]{36}))$/;
const COST_TEXT = /12,500|1250000|12500|5,000\.00|37,500|3750000/;

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
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains('sr-only')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 40 || r.width < 40)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    const bar = document.querySelector('[data-action-bar]')?.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label]')?.getBoundingClientRect();
    return { overflow: doc.scrollWidth - doc.clientWidth, small, barOverlapsNav: bar && nav ? bar.bottom > nav.top + 1 : false };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.barOverlapsNav, `${label}: action bar overlaps bottom nav`).toBe(false);
  expect.soft(result.small, `${label}: touch targets under 40px`).toEqual([]);
}

const MATRIX: Array<{ size: SizeKey; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'se', locale: 'en', theme: 'light' },
];

const png = { name: 'delivery-note.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };

for (const cell of MATRIX) {
  const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
  const use = { viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

  test.describe(`${tag} station staff (no cost authority)`, () => {
    test.use(use);

    test('list · wizard without cost · supplier-note photo · draft saved with attachment · detail + documents', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockB5Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: CREATOR, canSeeCost: false });
      const at = (name: string) => `${tag}/staff/${name}`;
      const n = mock.names;

      await page.goto(`${baseUrl}${RCV}`);
      await settle(page);
      await shot(page, at('01-list'));
      await audit(page, `${tag} list`);
      expect(await page.locator('body').innerText()).not.toMatch(COST_TEXT);
      await expect(page.locator('[data-costs-link]')).toHaveCount(0); // قائمة التكلفة لمن يراها فقط
      await page.locator('#rcv-search').fill('101');
      await page.waitForTimeout(600);
      await shot(page, at('02-list-search'));
      await audit(page, `${tag} search`);

      await page.goto(`${baseUrl}${RCV}/new`);
      await settle(page);
      await page.getByRole('radio', { name: new RegExp(n.suppliers[0]) }).click();
      await page.getByRole('radio', { name: new RegExp(n.tanks[0]) }).click();
      await page.locator('#rcv-note').fill('DN-FX-200');
      await shot(page, at('03-step1'));
      await page.locator('[data-next-step]').click();
      await page.getByTestId('rcv-dispatched').fill('10000');
      await page.getByTestId('rcv-received').fill('9950');
      await expect(page.getByTestId('rcv-cost')).toHaveCount(0); // لا حقل تكلفة في المعالج
      await shot(page, at('04-step2-no-cost'));
      await audit(page, `${tag} step2`);
      await page.locator('[data-next-step]').click();
      await page.getByTestId('rcv-before').fill('1200');
      await page.getByTestId('rcv-after').fill('11200');
      await page.locator('[data-next-step]').click();
      await expect(page.locator('[data-take-photo]')).toBeVisible();
      await shot(page, at('05-step4-documents-empty'));
      await audit(page, `${tag} documents`);
      await page.locator('[data-file-input]').setInputFiles(png);
      await page.locator('[data-staged]').waitFor();
      await shot(page, at('06-step4-documents-staged'));
      await audit(page, `${tag} staged`);
      await page.locator('[data-next-step]').click();
      await shot(page, at('07-review'));
      await audit(page, `${tag} review`);
      await page.locator('[data-save-draft]').click();
      await page.locator('[data-created]').waitFor();
      await page.locator('[data-upload-state="done"]').waitFor();
      await shot(page, at('08-created'));

      const create = mock.posts.find((p) => p.path === '/fuel-stations/deliveries');
      expect(create?.body).not.toHaveProperty('received_total_cost_minor');
      expect(mock.posts.some((p) => p.path.endsWith('/attachments') && (p.body.files as string[]).includes('delivery-note.png'))).toBe(true);

      await page.goto(`${baseUrl}${RCV}/${DRAFT_ID}`);
      await settle(page);
      await shot(page, at('09-detail-draft-cost-blind'));
      await audit(page, `${tag} detail`);
      expect(await page.locator('body').innerText()).not.toMatch(COST_TEXT);
      await expect(page.locator('[data-cost-state="missing"]')).toBeVisible();
      await expect(page.locator('[data-variant]')).toHaveCount(0); // نسخة تشغيلية فقط
      await expect(page.locator('[data-cost-save]')).toHaveCount(0);

      await page.goto(`${baseUrl}${RCV}/${COSTED_ID}`);
      await settle(page);
      await page.locator('[data-attachment-id] button[aria-label]').first().click(); // معاينة
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(400);
      await shot(page, at('10-attachment-preview'));
      await audit(page, `${tag} preview`);

      const writes = mock.requests.filter((r) => r.method !== 'GET');
      expect(writes.every((r) => ['POST', 'DELETE'].includes(r.method) && WRITE.test(r.path)), JSON.stringify(writes)).toBe(true);
      expect(mock.posts.some((p) => p.path.endsWith('/approve') || p.path.endsWith('/cost'))).toBe(false);
      expect(mock.issues).toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  });

  test.describe(`${tag} finance (cost authority)`, () => {
    test.use(use);

    test('cost queue · record cost with confirmation · financial documents', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockB5Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: FINANCE, canSeeCost: true });
      const at = (name: string) => `${tag}/finance/${name}`;

      await page.goto(`${baseUrl}${RCV}`);
      await settle(page);
      await shot(page, at('01-list'));
      await audit(page, `${tag} list`);

      await page.locator('[data-costs-link]').click();
      await page.locator('[data-pending-costs]').waitFor();
      await shot(page, at('02-cost-queue'));
      await audit(page, `${tag} queue`);
      await expect(page.locator(`[data-pending-id="${COSTED_ID}"]`)).toHaveCount(0);

      await page.getByTestId('rcv-cost-input').first().fill('12500.50');
      await page.locator('[data-cost-save]').first().click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(250);
      await shot(page, at('03-cost-confirm'));
      await audit(page, `${tag} confirm`);
      await page.locator('[data-cost-confirm]').click();
      await expect(page.locator('[data-pending-costs] li')).toHaveCount(0);
      await shot(page, at('04-queue-empty-after-record'));

      await page.goto(`${baseUrl}${RCV}/${DRAFT_ID}`);
      await settle(page);
      await shot(page, at('05-detail-with-cost'));
      await audit(page, `${tag} detail`);
      await page.locator('[data-variant="financial"]').click();
      await shot(page, at('06-documents-financial'));
      await audit(page, `${tag} documents`);

      const cost = mock.posts.find((p) => p.path.endsWith('/cost'));
      expect(cost?.body).toEqual({ received_total_cost_minor: 1_250_050 });
      expect(mock.posts.some((p) => p.path.endsWith('/approve'))).toBe(false);
      expect(mock.issues).toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  });

  test.describe(`${tag} approver`, () => {
    test.use(use);

    test('readiness blocked without cost · approval of a costed draft · distinct-approver refusal · approved', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockB5Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: APPROVER, canSeeCost: false });
      const at = (name: string) => `${tag}/approver/${name}`;

      await page.goto(`${baseUrl}${RCV}/${DRAFT_ID}`);
      await settle(page);
      await shot(page, at('01-blocked-no-cost'));
      await audit(page, `${tag} blocked`);
      await expect(page.locator('[data-approve-action]')).toBeDisabled();
      await expect(page.locator('[data-not-ready]')).toBeVisible();

      await page.goto(`${baseUrl}${RCV}/${COSTED_ID}`);
      await settle(page);
      await shot(page, at('02-ready'));
      await audit(page, `${tag} ready`);
      expect(await page.locator('body').innerText()).not.toMatch(COST_TEXT);
      await expect(page.locator('[data-approve-action]')).toBeEnabled();
      await page.locator('[data-approve-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(250);
      await shot(page, at('03-confirm'));
      mock.controls.distinctApprover = true;
      await page.locator('[data-confirm-approve]').click();
      await page.locator('[data-failure="rejected"]').waitFor();
      await shot(page, at('04-distinct-refusal'));
      await audit(page, `${tag} refusal`);
      await page.locator('[data-approve-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.locator('[data-confirm-approve]').click();
      await page.locator('[data-approved-success]').waitFor();
      await shot(page, at('05-approved'));

      const approves = mock.posts.filter((p) => p.path.endsWith('/approve'));
      expect(approves).toHaveLength(2);
      for (const a of approves) expect(a.body).not.toHaveProperty('expected_total_cost_minor'); // أعمى عن التكلفة: لا يرسل قيمتها
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
