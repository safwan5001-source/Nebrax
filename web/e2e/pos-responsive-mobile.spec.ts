import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-pos-responsive');
const ignoredConsole = /net::ERR_ABORTED|\.css\.map|_rsc=|404 \(Not Found\)|Failed to load resource/;
const SEARCH = /ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/;
const SESSION = /فتح جلسة جديدة|Open new session/;
const VIEW_CART = /عرض السلة|View cart/;
const PAY = /^دفع$|^Pay$/;
const MORE_ACTIONS = /إجراءات إضافية|More actions/;
const RECENT_INVOICES = /آخر الفواتير|Recent invoices/;
const PRODUCTS_NAV = /المنتجات|Products/;
const CUSTOMERS_NAV = /العملاء|Customers/;
const CONFIRM_PAY = /تأكيد الدفع|Confirm payment/;
const BACK_CART = /رجوع للسلة|Back to cart/;

test.describe.configure({ mode: 'serial' });

test.describe('PR-6 POS responsive / mobile hardening', () => {
  test('viewports, split tablet, mobile cart, and desktop regression', async ({ page, browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'captures are driven inside this test');
    test.setTimeout(420_000);
    await mkdir(evidenceDir, { recursive: true });
    const consoleErrors: string[] = [];
    attachConsole(page, consoleErrors);

    await enterDemo(page);
    await openPos(page);
    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openPos(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectSaleShell(page);
    await assertNoErpChrome(page);
    await assertPhoneChrome(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-ar-rtl-light.png') });

    await addFirstProduct(page);
    await expect(page.getByRole('button', { name: VIEW_CART })).toBeVisible();
    await page.getByRole('button', { name: VIEW_CART }).click();
    await expect(page.getByRole('button', { name: PAY })).toBeVisible();
    await expect(page.getByRole('button', { name: /زيادة كمية المرتجع|Increase return quantity/ })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-cart-open.png') });

    await page.getByRole('button', { name: PAY }).click();
    await expect(page.getByRole('button', { name: CONFIRM_PAY })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-payment.png') });
    await page.getByRole('button', { name: BACK_CART }).click();
    await expect(page.getByPlaceholder(SEARCH).or(page.getByRole('button', { name: PAY }))).toBeVisible();

    await page.getByRole('button', { name: PRODUCTS_NAV }).click();
    await page.getByRole('button', { name: CUSTOMERS_NAV }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertDialogInViewport(page);
    await page.getByRole('dialog').getByRole('button', { name: 'إغلاق' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: MORE_ACTIONS }).click();
    await expect(page.getByRole('menuitem', { name: RECENT_INVOICES })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-more-menu.png') });
    await page.getByRole('menuitem', { name: RECENT_INVOICES }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertDialogInViewport(page);
    await page.getByRole('dialog').getByRole('button', { name: 'إغلاق' }).click();

    const mobileDark = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobileDarkErrors: string[] = [];
    attachConsole(mobileDark, mobileDarkErrors);
    await enterDemo(mobileDark);
    await applyAppearance(mobileDark, { locale: 'ar', theme: 'dark' });
    await openPos(mobileDark);
    await expectSaleShell(mobileDark);
    await assertPhoneChrome(mobileDark);
    await assertNoHorizontalOverflow(mobileDark);
    await mobileDark.screenshot({ path: path.join(evidenceDir, 'mobile-390-ar-rtl-dark.png') });
    await mobileDark.close();

    const mobileLtr = await browser.newPage({
      viewport: { width: 430, height: 932 },
      hasTouch: true,
      isMobile: true,
    });
    const mobileLtrErrors: string[] = [];
    attachConsole(mobileLtr, mobileLtrErrors);
    await enterDemo(mobileLtr);
    await applyAppearance(mobileLtr, { locale: 'en', theme: 'light' });
    await openPos(mobileLtr);
    await expectSaleShell(mobileLtr);
    await assertPhoneChrome(mobileLtr);
    await assertNoHorizontalOverflow(mobileLtr);
    await addFirstProduct(mobileLtr);
    await expect(mobileLtr.getByRole('button', { name: VIEW_CART })).toBeVisible();
    await mobileLtr.close();

    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openPos(page);

    for (const size of [
      { width: 768, height: 1024, file: 'tablet-768-ar-rtl.png' },
      { width: 834, height: 1194, file: 'tablet-834-ar-rtl.png' },
    ]) {
      await page.setViewportSize(size);
      await expectSaleShell(page);
      await assertTabletSplit(page);
      await assertNoHorizontalOverflow(page);
      await addFirstProduct(page);
      await expect(page.getByRole('button', { name: VIEW_CART })).toHaveCount(0);
      await expect(page.getByRole('button', { name: PAY })).toBeVisible();
      await page.getByRole('button', { name: /إضافة عميل|Add customer/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await assertDialogInViewport(page);
      await page.getByRole('dialog').getByRole('button', { name: 'إغلاق' }).click();
      await page.screenshot({ path: path.join(evidenceDir, size.file) });
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expectSaleShell(page);
    await assertDesktopTriple(page);
    await assertF4Hint(page, true);
    await assertShortcutFooter(page, true);
    await assertNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await applyAppearance(page, { locale: 'en', theme: 'light' });
    await openPos(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expectSaleShell(page);
    await assertDesktopTriple(page);
    await runDesktopKeyboardSmoke(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-en-ltr.png') });

    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openPos(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl.png') });

    expect(consoleErrors, `desktop console:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(mobileDarkErrors, `mobile dark console:\n${mobileDarkErrors.join('\n')}`).toEqual([]);
    expect(mobileLtrErrors, `mobile 430 console:\n${mobileLtrErrors.join('\n')}`).toEqual([]);
  });
});

function attachConsole(page: Page, bucket: string[]) {
  page.on('console', (message) => {
    if (message.type() === 'error' && !ignoredConsole.test(message.text())) {
      bucket.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    bucket.push(error.message);
  });
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
  await page.goto('/pos', { waitUntil: 'load' });
  const search = page.getByPlaceholder(SEARCH);
  const session = page.getByText(SESSION);
  await expect(search.or(session)).toBeVisible({ timeout: 30_000 });
  if (await session.isVisible().catch(() => false) && !(await search.isVisible().catch(() => false))) {
    const device = page.locator('#pos-device');
    if (await device.isEnabled().catch(() => false)) {
      const options = await device.locator('option').allTextContents();
      const firstReal = options.find((label) => label.trim() && !/select|اختر/i.test(label));
      if (firstReal) await device.selectOption({ label: firstReal });
    }
    await page.locator('#ob').fill('100');
    await page.getByRole('button', { name: /فتح جلسة|Open/ }).click();
  }
  await expect(page.getByPlaceholder(SEARCH)).toBeVisible({ timeout: 30_000 });
}

async function expectSaleShell(page: Page) {
  await expect(page.getByPlaceholder(SEARCH)).toBeVisible();
  await expect(page.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toHaveCount(0);
}

async function assertNoErpChrome(page: Page) {
  await expect(page.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /لوحة التحكم|Dashboard/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /العودة للنظام|Return to system/ })).toBeVisible();
}

async function assertPhoneChrome(page: Page) {
  const nav = page.locator('nav').filter({ hasText: PRODUCTS_NAV });
  await expect(nav).toBeVisible();
  await expect(nav).toHaveClass(/md:hidden/);
  await expect(nav).toHaveClass(/safe-area-inset-bottom/);
}

async function assertTabletSplit(page: Page) {
  await expect(page.getByPlaceholder(SEARCH)).toBeVisible();
  await expect(page.getByRole('button', { name: PAY })).toBeVisible();
  await expect(page.locator('nav').filter({ hasText: PRODUCTS_NAV })).toBeHidden();
  await expect(page.getByRole('button', { name: VIEW_CART })).toHaveCount(0);
  await expect(page.getByLabel(/الأقسام|Categories/).first()).toBeVisible();
}

async function assertDesktopTriple(page: Page) {
  await expect(page.getByPlaceholder(SEARCH)).toBeVisible();
  await expect(page.getByRole('button', { name: PAY })).toBeVisible();
  await expect(page.locator('nav').filter({ hasText: PRODUCTS_NAV })).toBeHidden();
  await expect(page.locator('aside').filter({ hasText: /الأقسام|Categories/ })).toBeVisible();
}

async function assertF4Hint(page: Page, visible: boolean) {
  const hint = page.locator('section kbd', { hasText: 'F4' });
  if (visible) await expect(hint).toBeVisible();
  else await expect(hint).toBeHidden();
}

async function assertShortcutFooter(page: Page, visible: boolean) {
  const footer = page.locator('footer').filter({ has: page.locator('kbd', { hasText: 'F2' }) });
  if (visible) await expect(footer).toBeVisible();
  else await expect(footer).toBeHidden();
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
}

async function assertDialogInViewport(page: Page) {
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box, 'dialog bounding box').toBeTruthy();
  expect(viewport, 'viewport').toBeTruthy();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-2);
  expect(box.y).toBeGreaterThanOrEqual(-2);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2);
}

async function productButtons(page: Page) {
  return page.locator('section button[aria-selected]');
}

async function addFirstProduct(page: Page) {
  const products = await productButtons(page);
  await expect(products.first()).toBeVisible();
  await products.first().click();
}

async function runDesktopKeyboardSmoke(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const search = page.getByPlaceholder(SEARCH);
  await page.keyboard.press('F4');
  await expect(search).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => page.locator('section button[aria-selected="true"]').count()).toBeGreaterThan(0);

  await addFirstProduct(page);
  await page.keyboard.press('F9');
  await expect(page.getByRole('button', { name: CONFIRM_PAY })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: CONFIRM_PAY })).toHaveCount(0);
}
