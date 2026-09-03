import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openPosSellingWorkspace } from './helpers/open-pos';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-557');
/** ضوضاء Next/Chromium المعروفة فقط — لا تبتلع فشل موارد غير متوقع. */
const KNOWN_CONSOLE_NOISE = /net::ERR_ABORTED|\.css\.map|[?&]_rsc=|\/favicon\.ico(?:\?|$)/;
const UNEXPECTED_HTTP_STATUS = /status of (401|403|500)\b/;
const SEARCH = /ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/;
const SAVE = /حفظ الإعدادات|Save settings/;

test.describe.configure({ mode: 'serial' });

test.describe('PR-7 POS interaction mode settings', () => {
  test('persist modes and apply policy on /pos', async ({ page, browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'captures are driven inside this test');
    test.setTimeout(360_000);
    await mkdir(evidenceDir, { recursive: true });
    const consoleErrors: string[] = [];
    attachConsole(page, consoleErrors);

    await enterDemo(page);
    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openConfiguration(page);
    await expect(page.locator('#interaction_mode_AUTO')).toBeChecked();
    await expect(page.getByText(/موصى به|Recommended/).first()).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'settings-ar-rtl-light.png'), fullPage: true });

    await page.locator('#interaction_mode_TOUCH').check();
    await saveConfiguration(page);
    await expect(page.locator('#interaction_mode_TOUCH')).toBeChecked();
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('pos-interaction-mode')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#interaction_mode_TOUCH')).toBeChecked();

    await openPos(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await expectSaleShell(page);
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-interaction-mode', 'TOUCH');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-shortcut-hints', 'off');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-scanner-enabled', 'on');
    await expect(page.getByTestId('pos-shortcut-footer')).toBeHidden();
    await page.screenshot({ path: path.join(evidenceDir, 'pos-touch-desktop.png') });

    await openConfiguration(page);
    await page.locator('#interaction_mode_KEYBOARD_MOUSE').check();
    await saveConfiguration(page);
    await expect(page.locator('#interaction_mode_KEYBOARD_MOUSE')).toBeChecked();

    await openPos(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await expectSaleShell(page);
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-interaction-mode', 'KEYBOARD_MOUSE');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-shortcut-hints', 'on');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-scanner-enabled', 'on');
    await expect(page.getByTestId('pos-shortcut-footer')).toBeVisible();
    await page.keyboard.press('F4');
    await expect(page.getByPlaceholder(SEARCH)).toBeFocused();
    await page.screenshot({ path: path.join(evidenceDir, 'pos-keyboard-mouse-desktop.png') });

    await openConfiguration(page);
    await page.locator('#interaction_mode_HYBRID').check();
    await saveConfiguration(page);
    await expect(page.locator('#interaction_mode_HYBRID')).toBeChecked();

    await openPos(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await expectSaleShell(page);
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-interaction-mode', 'HYBRID');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-scanner-enabled', 'on');
    const product = page.locator('section button[aria-selected]').first();
    await expect(product).toBeVisible();
    await product.click();
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-keyboard-power', 'off');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-keyboard-power', 'on');
    await page.screenshot({ path: path.join(evidenceDir, 'pos-hybrid-desktop.png') });

    await openConfiguration(page);
    await page.locator('#interaction_mode_AUTO').check();
    await saveConfiguration(page);
    await expect(page.locator('#interaction_mode_AUTO')).toBeChecked();

    await openPos(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await expectSaleShell(page);
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-interaction-mode', 'AUTO');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-shortcut-hints', 'on');
    await expect(page.getByTestId('pos-shortcut-footer')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectSaleShell(page);
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-shortcut-hints', 'off');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-prefer-touch', 'on');
    await expect(page.getByTestId('pos-sale-shell')).toHaveAttribute('data-scanner-enabled', 'on');

    await applyAppearance(page, { locale: 'ar', theme: 'dark' });
    await openConfiguration(page);
    await page.screenshot({ path: path.join(evidenceDir, 'settings-ar-rtl-dark.png'), fullPage: true });

    await applyAppearance(page, { locale: 'en', theme: 'light' });
    await openConfiguration(page);
    await expect(page.getByRole('radio', { name: /^Auto/i })).toBeVisible();
    await expect(page.getByText('Recommended')).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'settings-en-ltr-light.png'), fullPage: true });

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobileErrors: string[] = [];
    attachConsole(mobile, mobileErrors);
    await enterDemo(mobile);
    await applyAppearance(mobile, { locale: 'ar', theme: 'light' });
    await openConfiguration(mobile);
    await expect(mobile.locator('#interaction_mode_AUTO')).toBeVisible();
    await mobile.screenshot({ path: path.join(evidenceDir, 'settings-mobile-390.png'), fullPage: true });
    await mobile.close();

    expect(consoleErrors, `desktop console:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(mobileErrors, `mobile console:\n${mobileErrors.join('\n')}`).toEqual([]);
  });
});

function isKnownConsoleNoise(text: string, url = ''): boolean {
  if (UNEXPECTED_HTTP_STATUS.test(text) || UNEXPECTED_HTTP_STATUS.test(url)) return false;
  if (KNOWN_CONSOLE_NOISE.test(text) || KNOWN_CONSOLE_NOISE.test(url)) return true;
  // Chromium غالباً يسجّل 404 للـ favicon بلا مسار في النص.
  return /Failed to load resource/.test(text) && /status of 404/.test(text) && (!url || /\/favicon\.ico(?:\?|$)/.test(url));
}

function attachConsole(page: Page, bucket: string[]) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const url = message.location().url ?? '';
    if (isKnownConsoleNoise(text, url)) return;
    bucket.push(url ? `${text} (${url})` : text);
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

async function saveConfiguration(page: Page) {
  await page.getByRole('button', { name: SAVE }).click();
  await expect(page.getByTestId('pos-interaction-mode')).toBeVisible({ timeout: 20_000 });
}

async function openConfiguration(page: Page) {
  await page.goto('/pos/settings/configuration', { waitUntil: 'load' });
  await expect(page.getByTestId('pos-interaction-mode')).toBeVisible({ timeout: 30_000 });
}

async function openPos(page: Page) {
  await openPosSellingWorkspace(page);
}

async function expectSaleShell(page: Page) {
  await expect(page.getByPlaceholder(SEARCH)).toBeVisible();
  await expect(page.getByTestId('pos-sale-shell')).toBeVisible();
}
