import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), '../docs/phase4-visual-qa');
const ignoredConsole = /net::ERR_ABORTED|\.css\.map|_rsc=|404 \(Not Found\)|Failed to load resource/;

test.describe.configure({ mode: 'serial' });

test.describe('Phase 4 visual QA', () => {
  test('Needs Attention + loss-prevention settings across locales, themes, and mobile', async ({ page, browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'captures are driven inside this test');
    test.setTimeout(240_000);
    await mkdir(evidenceDir, { recursive: true });
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !ignoredConsole.test(message.text())) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await enterDemo(page);
    await captureAttention(page, 'ar-light-attention.png');
    await captureSettings(page, 'ar-light-settings-loss-prevention.png');

    await applyAppearance(page, { locale: 'ar', theme: 'dark' });
    await captureAttention(page, 'ar-dark-attention.png');

    await applyAppearance(page, { locale: 'en', theme: 'light' });
    await captureAttention(page, 'en-light-attention.png');
    await captureSettings(page, 'en-light-settings-loss-prevention.png');

    await applyAppearance(page, { locale: 'en', theme: 'dark' });
    await captureAttention(page, 'en-dark-attention.png');

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobileErrors: string[] = [];
    mobile.on('console', (message) => {
      if (message.type() === 'error' && !ignoredConsole.test(message.text())) {
        mobileErrors.push(message.text());
      }
    });
    await enterDemo(mobile);
    await applyAppearance(mobile, { locale: 'ar', theme: 'dark' });
    await captureAttention(mobile, 'mobile-ar-dark-attention.png');
    await applyAppearance(mobile, { locale: 'en', theme: 'light' });
    await captureSettings(mobile, 'mobile-en-light-settings.png');
    await mobile.close();

    expect(consoleErrors, `desktop console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(mobileErrors, `mobile console errors:\n${mobileErrors.join('\n')}`).toEqual([]);
  });
});

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

async function captureAttention(page: Page, filename: string) {
  await page.goto('/pos/audit', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: /الرقابة والتدقيق|Control and audit|Control & audit/ })).toBeVisible({ timeout: 30_000 });
  const tab = page.locator('#tab-attention');
  await expect(tab).toBeVisible();
  await tab.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByText(/قائمة موحّدة للقراءة فقط|read-only queue of items/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/مرتجع من كاشير مختلف|Cross-cashier refund/).filter({ visible: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/مؤشرات المراجعة تُرتّب أولوية المراجعة|Review indicators prioritize review/).filter({ visible: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, filename), fullPage: true });
}

async function captureSettings(page: Page, filename: string) {
  await page.goto('/pos/settings/configuration', { waitUntil: 'load' });
  const section = page.getByText(/ضوابط منع الفقد|Loss prevention controls/).first();
  await expect(section).toBeVisible({ timeout: 30_000 });
  await section.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(page.getByLabel(/سياسة المرتجعات|Refund policy/)).toBeVisible();
  await expect(page.getByLabel(/منع اعتماد الكاشير فرق إغلاقه بنفسه|Block self-approval of closing variance/)).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, filename), fullPage: true });
}

