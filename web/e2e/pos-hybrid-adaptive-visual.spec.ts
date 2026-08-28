import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-549');
const ignoredConsole = /net::ERR_ABORTED|\.css\.map|_rsc=|404 \(Not Found\)|Failed to load resource/;
const SEARCH = /ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/;
const SESSION = /فتح جلسة جديدة|Open new session/;

test.describe.configure({ mode: 'serial' });

test.describe('PR-549 hybrid POS visual QA', () => {
  test('viewports, themes, locales, and hybrid input', async ({ page, browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'captures are driven inside this test');
    test.setTimeout(360_000);
    await mkdir(evidenceDir, { recursive: true });
    const consoleErrors: string[] = [];
    attachConsole(page, consoleErrors);

    await enterDemo(page);
    await openPos(page);
    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openPos(page);

    await page.setViewportSize({ width: 1366, height: 768 });
    await expectSaleShell(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-ar-rtl-light.png') });
    await assertNoHorizontalOverflow(page);
    await assertF4Hint(page, true);
    await assertShortcutFooter(page, true);

    await runHybridInteractions(page, evidenceDir);
    await runShortcutSmoke(page);

    await applyAppearance(page, { locale: 'ar', theme: 'dark' });
    await openPos(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expectSaleShell(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-ar-rtl-dark.png') });

    await applyAppearance(page, { locale: 'en', theme: 'light' });
    await openPos(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expectSaleShell(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-en-ltr-light.png') });

    await applyAppearance(page, { locale: 'en', theme: 'dark' });
    await openPos(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expectSaleShell(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-en-ltr-dark.png') });

    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openPos(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectSaleShell(page);
    await assertF4Hint(page, true);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1024-ar-rtl-light.png') });

    await page.setViewportSize({ width: 834, height: 1194 });
    await expectSaleShell(page);
    await assertF4Hint(page, false);
    await assertShortcutFooter(page, false);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'tablet-ar-rtl-light.png') });

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
    await assertF4Hint(mobileDark, false);
    await assertMobileSafeArea(mobileDark);
    await assertNoHorizontalOverflow(mobileDark);
    await addFirstProduct(mobileDark);
    await expect(mobileDark.getByRole('button', { name: /عرض السلة|View cart/ })).toBeVisible();
    await expect(mobileDark.locator('section div.grid').first()).toHaveClass(/pb-16/);
    await mobileDark.screenshot({ path: path.join(evidenceDir, 'mobile-ar-rtl-dark.png') });
    await mobileDark.close();

    const mobileLight = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobileLightErrors: string[] = [];
    attachConsole(mobileLight, mobileLightErrors);
    await enterDemo(mobileLight);
    await applyAppearance(mobileLight, { locale: 'en', theme: 'light' });
    await openPos(mobileLight);
    await expectSaleShell(mobileLight);
    await assertF4Hint(mobileLight, false);
    await assertNoHorizontalOverflow(mobileLight);
    await mobileLight.screenshot({ path: path.join(evidenceDir, 'mobile-en-ltr-light.png') });
    await mobileLight.close();

    expect(consoleErrors, `desktop console:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(mobileDarkErrors, `mobile dark console:\n${mobileDarkErrors.join('\n')}`).toEqual([]);
    expect(mobileLightErrors, `mobile light console:\n${mobileLightErrors.join('\n')}`).toEqual([]);
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
  await expect(page.locator('body')).toBeVisible();
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

async function assertMobileSafeArea(page: Page) {
  const nav = page.locator('nav').filter({ hasText: /المنتجات|Products/ });
  await expect(nav).toBeVisible();
  await expect(nav).toHaveClass(/safe-area-inset-bottom/);
}

async function productButtons(page: Page) {
  return page.locator('section button[aria-selected]');
}

async function addFirstProduct(page: Page) {
  const products = await productButtons(page);
  await expect(products.first()).toBeVisible();
  await products.first().click();
}

async function selectedCount(page: Page) {
  return page.locator('section button[aria-selected="true"]').count();
}

async function runHybridInteractions(page: Page, dir: string) {
  await page.setViewportSize({ width: 1366, height: 768 });
  const products = await productButtons(page);
  await expect(products.first()).toBeVisible();

  await products.first().click();
  expect(await selectedCount(page)).toBe(0);
  await page.screenshot({ path: path.join(dir, 'desktop-ar-pointer-no-ring.png') });

  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => selectedCount(page)).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(dir, 'desktop-ar-keyboard-ring.png') });

  await products.nth(1).click();
  expect(await selectedCount(page)).toBe(0);

  const beforeSelected = await selectedCount(page);
  await page.keyboard.type('2000000000002', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  expect(await selectedCount(page), 'scanner must not turn on keyboard rings').toBe(0);
  expect(beforeSelected).toBe(0);
  await page.screenshot({ path: path.join(dir, 'desktop-ar-after-scan.png') });

  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => selectedCount(page)).toBeGreaterThan(0);

  await products.first().click();
  await page.getByRole('button', { name: /اختيار العميل|Select customer/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const search = page.getByPlaceholder(SEARCH);
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(search).not.toBeFocused();

  await page.keyboard.press('F4');
  await expect(search).toBeFocused();
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(search).toBeFocused();
}

async function runShortcutSmoke(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.keyboard.press('F6');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByPlaceholder(SEARCH).blur();
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'o', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    }));
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await addFirstProduct(page);
  await page.keyboard.press('F9');
  await expect(page.getByRole('button', { name: /تأكيد الدفع|Confirm payment/ })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
}
