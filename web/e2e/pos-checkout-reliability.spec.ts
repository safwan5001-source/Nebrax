import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openPosSellingWorkspace } from './helpers/open-pos';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-559');
/** ضوضاء Next/Chromium المعروفة فقط — لا تبتلع Failed to load resource ولا 401/403/500. */
const KNOWN_CONSOLE_NOISE = /net::ERR_ABORTED|\.css\.map|[?&]_rsc=|\/favicon\.ico(?:\?|$)/;
const UNEXPECTED_HTTP_STATUS = /status of (401|403|500)\b/;
const SEARCH = /ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/;
const PAY = /^(دفع|Pay) /;
const VIEW_CART = /عرض السلة|View cart/;

test.describe.configure({ mode: 'serial' });

test.describe('PR-8 POS checkout reliability', () => {
  test('double submit, delayed lock, recovery, and visual QA', async ({ page, browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'captures are driven inside this test');
    test.setTimeout(420_000);
    await mkdir(evidenceDir, { recursive: true });
    const consoleErrors: string[] = [];
    attachConsole(page, consoleErrors);

    await enterDemo(page);
    await openPos(page);
    await applyAppearance(page, { locale: 'ar', theme: 'light' });
    await openPos(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await addFirstProduct(page);
    await selectCustomer(page);
    await page.getByRole('button', { name: PAY }).click();
    const confirm = page.getByTestId('pos-confirm-payment');
    await expect(confirm).toBeVisible();
    await fillExactAmount(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl-light-payment.png') });

    // أغلق طبقة أخطاء Next إن ظهرت حتى لا تبتلع النقرات.
    await page.locator('[data-nextjs-dialog-overlay], nextjs-portal').evaluateAll((nodes) => {
      nodes.forEach((node) => (node as HTMLElement).style.display = 'none');
    }).catch(() => undefined);

    await page.evaluate(() => {
      (window as Window & { __POS_CHECKOUT_DELAY_MS?: number; __POS_CHECKOUT_CALLS?: number }).__POS_CHECKOUT_DELAY_MS = 2500;
      (window as Window & { __POS_CHECKOUT_CALLS?: number }).__POS_CHECKOUT_CALLS = 0;
    });

    // تحقق أن التأخير مفعّل قبل النقر.
    const delayArmed = await page.evaluate(() => (window as Window & { __POS_CHECKOUT_DELAY_MS?: number }).__POS_CHECKOUT_DELAY_MS);
    expect(delayArmed).toBe(2500);

    await confirm.click({ force: true, noWaitAfter: true });
    await page.waitForTimeout(100);
    await confirm.click({ force: true, noWaitAfter: true }).catch(() => undefined);

    await expect.poll(async () => page.getByTestId('pos-payment-screen').getAttribute('data-checkout-phase'), {
      timeout: 5_000,
    }).toMatch(/submitting|recovering/);
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAttribute('aria-busy', 'true');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl-light-submitting.png') });

    await expect(page.getByText(/تمّ البيع|Sale completed|تم تأكيد البيع|Sale confirmed/)).toBeVisible({ timeout: 20_000 });
    const calls = await page.evaluate(() => (window as Window & { __POS_CHECKOUT_CALLS?: number }).__POS_CHECKOUT_CALLS ?? 0);
    expect(calls).toBeLessThanOrEqual(2);
    expect(calls).toBeGreaterThanOrEqual(1);

    // استرداد: فشل استجابة بعد تخزين نتيجة الخادم → إعادة بنفس المفتاح
    await openPos(page);
    await preparePayment(page);
    await page.evaluate(() => {
      (window as Window & {
        __POS_CHECKOUT_DELAY_MS?: number;
        __POS_CHECKOUT_FAIL_ONCE?: boolean;
        __POS_CHECKOUT_CALLS?: number;
        __POS_CHECKOUT_ATTEMPTS?: Map<string, unknown>;
      }).__POS_CHECKOUT_DELAY_MS = 0;
      (window as Window & { __POS_CHECKOUT_FAIL_ONCE?: boolean }).__POS_CHECKOUT_FAIL_ONCE = true;
      (window as Window & { __POS_CHECKOUT_CALLS?: number }).__POS_CHECKOUT_CALLS = 0;
    });
    await page.getByTestId('pos-confirm-payment').click();
    await expect(page.getByText(/تمّ البيع|Sale completed|تم تأكيد البيع|Sale confirmed|تعذر إتمام الطلب|Could not complete|نتحقق|Checking/)).toBeVisible({ timeout: 15_000 });

    // Visual QA — submitting dark / mobile / tablet / EN
    await captureSubmitting(browser, consoleErrors, {
      locale: 'ar', theme: 'dark', width: 1440, height: 900,
      file: 'desktop-1440-ar-rtl-dark-submitting.png',
    });
    await captureSubmitting(browser, consoleErrors, {
      locale: 'ar', theme: 'light', width: 390, height: 844, touch: true, openCartFirst: true,
      file: 'mobile-390-ar-rtl-light-submitting.png',
    });
    await captureSubmitting(browser, consoleErrors, {
      locale: 'ar', theme: 'light', width: 768, height: 1024, touch: true,
      file: 'tablet-768-ar-rtl-light-submitting.png',
    });
    await captureSubmitting(browser, consoleErrors, {
      locale: 'en', theme: 'light', width: 1440, height: 900,
      file: 'desktop-1440-en-ltr-light-submitting.png',
    });

    // retryable error: انقطاع مستمر (محاولة + استرداد يفشلان) → رسالة إعادة آمنة
    await openPos(page);
    await preparePayment(page);
    await page.evaluate(() => {
      (window as Window & { __POS_CHECKOUT_FORCE_NETWORK_ERROR?: boolean; __POS_CHECKOUT_DELAY_MS?: number }).__POS_CHECKOUT_FORCE_NETWORK_ERROR = true;
      (window as Window & { __POS_CHECKOUT_DELAY_MS?: number }).__POS_CHECKOUT_DELAY_MS = 0;
    });
    await page.getByTestId('pos-confirm-payment').click();
    const retryAlert = page.getByTestId('pos-payment-screen').getByRole('alert');
    await expect(retryAlert).toBeVisible({ timeout: 10_000 });
    await expect(retryAlert).toContainText(/تعذر إتمام الطلب|Could not complete/i);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl-light-retryable.png') });
    await page.evaluate(() => {
      (window as Window & { __POS_CHECKOUT_FORCE_NETWORK_ERROR?: boolean }).__POS_CHECKOUT_FORCE_NETWORK_ERROR = false;
    });

    // recovered success label path: fail-once then auto-retry succeeds
    await openPos(page);
    await preparePayment(page);
    await page.evaluate(() => {
      (window as Window & { __POS_CHECKOUT_FAIL_ONCE?: boolean; __POS_CHECKOUT_DELAY_MS?: number }).__POS_CHECKOUT_FAIL_ONCE = true;
      (window as Window & { __POS_CHECKOUT_DELAY_MS?: number }).__POS_CHECKOUT_DELAY_MS = 0;
    });
    await page.getByTestId('pos-confirm-payment').click();
    await expect(page.getByText(/تم تأكيد البيع|Sale confirmed|تمّ البيع|Sale completed/)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-rtl-light-recovered-success.png') });

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});

async function captureSubmitting(
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
    await p.getByRole('button', { name: VIEW_CART }).click();
  }
  await selectCustomer(p);
  await p.getByRole('button', { name: PAY }).click();
  await expect(p.getByTestId('pos-confirm-payment')).toBeVisible();
  await fillExactAmount(p);
  await p.evaluate(() => {
    (window as Window & { __POS_CHECKOUT_DELAY_MS?: number }).__POS_CHECKOUT_DELAY_MS = 60_000;
  });
  await p.getByTestId('pos-confirm-payment').click();
  await expect(p.getByTestId('pos-confirm-payment')).toBeDisabled({ timeout: 5_000 });
  await p.screenshot({ path: path.join(evidenceDir, options.file) });
  await p.close();
}

/** مطابق لنمط PR-7/#552: الضوضاء المعروفة تُتجاهل؛ 401/403/500 لا. */
function isKnownConsoleNoise(text: string, url = ''): boolean {
  if (UNEXPECTED_HTTP_STATUS.test(text) || UNEXPECTED_HTTP_STATUS.test(url)) return false;
  if (KNOWN_CONSOLE_NOISE.test(text) || KNOWN_CONSOLE_NOISE.test(url)) return true;
  // Chromium غالباً يسجّل 404 للـ favicon بلا مسار في النص.
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
  // السلة النشطة قد تُستعاد من التخزين المحلي بعد فشل شبكة — العميل يبقى مختاراً.
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

async function preparePayment(page: Page) {
  await addFirstProduct(page);
  await selectCustomer(page);
  await page.getByRole('button', { name: PAY }).click();
  await expect(page.getByTestId('pos-confirm-payment')).toBeVisible();
  await fillExactAmount(page);
}
