import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openPosSellingWorkspace } from './helpers/open-pos';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-9');
/** ضوضاء Next/Chromium المعروفة فقط — لا تبتلع Failed to load resource ولا 401/403/500. */
const KNOWN_CONSOLE_NOISE = /net::ERR_ABORTED|\.css\.map|[?&]_rsc=|\/favicon\.ico(?:\?|$)/;
const UNEXPECTED_HTTP_STATUS = /status of (401|403|500)\b/;
const SEARCH = /ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/;
const PAY = /^(دفع|Pay) /;
const VIEW_CART = /عرض السلة|View cart/;
const RESTORED = /تم استعادة السلة السابقة|Previous cart restored/;

test.describe.configure({ mode: 'serial' });

test.describe('PR-9 POS session & cart recovery', () => {
  test('reload restores cart, payment does not auto-charge, offline blocks, visual QA', async ({ page, browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'captures are driven inside this test');
    test.setTimeout(420_000);
    await mkdir(evidenceDir, { recursive: true });
    const consoleErrors: string[] = [];
    attachConsole(page, consoleErrors);

    await enterDemo(page);
    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openPos(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await addFirstProduct(page);
    await expect(page.getByRole('button', { name: PAY })).toBeEnabled();

    // 1) سلة → reload → استعادة مرة واحدة بنفس الهوية
    const beforeIds = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('nibras_pos_active_carts:'));
      const raw = keys[0] ? localStorage.getItem(keys[0]) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { carts?: Array<{ id: string }>; activeId?: string };
      return { key: keys[0], activeId: parsed.activeId, cartIds: (parsed.carts ?? []).map((cart) => cart.id) };
    });
    expect(beforeIds?.cartIds.length).toBeGreaterThan(0);

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByPlaceholder(SEARCH)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(RESTORED)).toBeVisible({ timeout: 10_000 });

    const afterIds = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('nibras_pos_active_carts:'));
      const raw = keys[0] ? localStorage.getItem(keys[0]) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { carts?: Array<{ id: string }>; activeId?: string; v?: number };
      return { key: keys[0], activeId: parsed.activeId, cartIds: (parsed.carts ?? []).map((cart) => cart.id), v: parsed.v };
    });
    expect(afterIds?.activeId).toBe(beforeIds?.activeId);
    expect(afterIds?.cartIds).toEqual(beforeIds?.cartIds);
    expect(afterIds?.v).toBe(1);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl-light-restored-cart.png') });

    // 2) عدة سلال → reload → بلا تكرار
    await page.getByRole('button', { name: /سلة جديدة|New cart/i }).first().click();
    await addFirstProduct(page);
    const multiBefore = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('nibras_pos_active_carts:'));
      const raw = keys[0] ? localStorage.getItem(keys[0]) : null;
      const parsed = raw ? JSON.parse(raw) as { carts?: Array<{ id: string }> } : { carts: [] };
      return (parsed.carts ?? []).map((cart) => cart.id).sort();
    });
    expect(multiBefore.length).toBeGreaterThanOrEqual(2);
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByPlaceholder(SEARCH)).toBeVisible({ timeout: 30_000 });
    const multiAfter = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('nibras_pos_active_carts:'));
      const raw = keys[0] ? localStorage.getItem(keys[0]) : null;
      const parsed = raw ? JSON.parse(raw) as { carts?: Array<{ id: string }> } : { carts: [] };
      return (parsed.carts ?? []).map((cart) => cart.id).sort();
    });
    expect(multiAfter).toEqual(multiBefore);
    expect(new Set(multiAfter).size).toBe(multiAfter.length);

    // 3) شاشة دفع → reload → لا auto charge / تبقى على البيع
    await selectCustomer(page);
    await page.getByRole('button', { name: PAY }).click();
    await expect(page.getByTestId('pos-payment-screen')).toBeVisible();
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByPlaceholder(SEARCH)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pos-payment-screen')).toHaveCount(0);
    await expect(page.getByTestId('pos-confirm-payment')).toHaveCount(0);

    // 4) offline يمنع التأكيد
    await page.getByRole('button', { name: PAY }).click();
    await expect(page.getByTestId('pos-confirm-payment')).toBeVisible();
    await fillExactAmount(page);
    await page.context().setOffline(true);
    await expect(page.getByTestId('pos-recovery-banner')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('pos-confirm-payment')).toBeDisabled();
    await expect(page.getByTestId('pos-payment-screen')).toHaveAttribute('data-offline', '1');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl-light-offline.png') });
    await page.context().setOffline(false);
    await expect(page.getByTestId('pos-confirm-payment')).toBeEnabled({ timeout: 10_000 });

    // 5) جلسة مغلقة عن بُعد → حالة blocking (mock demo hook؛ الاستطلاع على online)
    await page.evaluate(() => {
      (window as Window & { __POS_SESSIONS_FORCE_EMPTY?: boolean }).__POS_SESSIONS_FORCE_EMPTY = true;
    });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('pos-session-invalid-banner')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/أُغلقت وردية|closed elsewhere|فتح جلسة بيع|Open Selling Session/).first()).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl-light-closed-session.png') });
    await page.evaluate(() => {
      (window as Window & { __POS_SESSIONS_FORCE_EMPTY?: boolean }).__POS_SESSIONS_FORCE_EMPTY = false;
    });

    // Visual QA — dark / mobile
    await captureRestored(browser, consoleErrors, {
      locale: 'ar', theme: 'dark', width: 1440, height: 900,
      file: 'desktop-1440-ar-rtl-dark-restored-cart.png',
    });
    await captureRestored(browser, consoleErrors, {
      locale: 'ar', theme: 'light', width: 390, height: 844, touch: true, openCartFirst: true,
      file: 'mobile-390-ar-rtl-light-restored-cart.png',
    });

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});

async function captureRestored(
  browser: import('@playwright/test').Browser,
  consoleErrors: string[],
  options: {
    locale: 'ar' | 'en';
    theme: 'light' | 'dark';
    width: number;
    height: number;
    touch?: boolean;
    openCartFirst?: boolean;
    file: string;
  },
) {
  const p = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    hasTouch: options.touch ?? false,
  });
  attachConsole(p, consoleErrors);
  await enterDemo(p);
  await applyAppearance(p, { locale: options.locale, theme: options.theme });
  await openPos(p);
  await addFirstProduct(p);
  if (options.openCartFirst) {
    await p.getByRole('button', { name: VIEW_CART }).click().catch(() => undefined);
  }
  await p.reload({ waitUntil: 'load' });
  await expect(p.getByPlaceholder(SEARCH)).toBeVisible({ timeout: 30_000 });
  await p.screenshot({ path: path.join(evidenceDir, options.file) });
  await p.close();
}

function isKnownConsoleNoise(text: string, url = ''): boolean {
  if (UNEXPECTED_HTTP_STATUS.test(text) || UNEXPECTED_HTTP_STATUS.test(url)) return false;
  if (KNOWN_CONSOLE_NOISE.test(text) || KNOWN_CONSOLE_NOISE.test(url)) return true;
  return /Failed to load resource/.test(text) && /status of 404/.test(text) && (!url || /\/favicon\.ico(?:\?|$)/.test(url));
}

function attachConsole(page: Page, sink: string[]) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const url = msg.location().url ?? '';
    if (isKnownConsoleNoise(text, url)) return;
    sink.push(url ? `${text} (${url})` : text);
  });
  page.on('pageerror', (error) => sink.push(String(error)));
}

async function enterDemo(page: Page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.getByRole('button', { name: /دخول تجريبي|Demo login/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const closeBanner = page.getByRole('button', { name: /إغلاق|Close/ });
  if (await closeBanner.isVisible().catch(() => false)) {
    await closeBanner.click();
  }
}

async function applyAppearance(page: Page, options: { locale: 'ar' | 'en'; theme: 'light' | 'dark' }) {
  await page.evaluate(({ locale, theme }) => {
    document.cookie = `locale=${locale};path=/;max-age=31536000;samesite=lax`;
    localStorage.setItem('theme', theme);
  }, options);
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('html')).toHaveAttribute('lang', options.locale);
  await expect(page.locator('html')).toHaveAttribute('dir', options.locale === 'ar' ? 'rtl' : 'ltr');
  if (options.theme === 'dark') {
    await expect(page.locator('html')).toHaveClass(/dark/);
  } else {
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  }
}

async function openPos(page: Page) {
  await openPosSellingWorkspace(page);
}

async function addFirstProduct(page: Page) {
  const products = page.locator('section button[aria-selected]');
  await expect(products.first()).toBeVisible();
  await products.first().click();
}

async function selectCustomer(page: Page) {
  const already = page.getByRole('button', { name: /مؤسسة الخليج|Gulf/ }).first();
  if (await already.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /اختيار العميل|Select customer/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /مؤسسة الخليج|Gulf/ }).first().click();
  await expect(dialog).toHaveCount(0);
}

async function fillExactAmount(page: Page) {
  const exact = page.getByRole('button', { name: /المبلغ المستحق|Exact amount|المبلغ بالضبط/ });
  await expect(exact).toBeVisible();
  await exact.click();
}
