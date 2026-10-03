import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seedDemoSession } from './helpers/demo-session';
import { openPosSellingWorkspace } from './helpers/open-pos';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pos-ui-v3-verify');
const SEARCH = /ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/;
const VIEW_CART = /عرض السلة|View cart/;
const PAY = /^(دفع|Pay)( |$)/;
const CONFIRM = /تأكيد الدفع|Confirm payment/;
const INCREASE = /زيادة كمية المرتجع|Increase return quantity/;
const BARCODE = '2000000000003';

type Shot = { file: string; viewport: string; locale: string; theme: string; workspace: string };
type Finding = { severity: 'blocker' | 'major' | 'minor' | 'note'; id: string; detail: string };

test.describe.configure({ mode: 'serial' });

test('POS UI V3 visual verify', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one browser drives every viewport');
  test.setTimeout(600_000);
  await mkdir(evidenceDir, { recursive: true });
  const shots: Shot[] = [];
  const findings: Finding[] = [];
  const measurements: unknown[] = [];

  page.on('pageerror', (error) => {
    findings.push({ severity: 'major', id: 'pageerror', detail: error.message });
  });

  await seedDemoSession(page);
  await page.goto('/dashboard', { waitUntil: 'load' });
  await expect(page).toHaveURL(/\/dashboard$/);

  const cases: Array<{ id: string; width: number; height: number; locale: 'ar' | 'en'; theme: 'light' | 'dark'; workspace: 'products' | 'cart' | 'payment' }> = [
    { id: '390-ar-light-products', width: 390, height: 844, locale: 'ar', theme: 'light', workspace: 'products' },
    { id: '390-ar-dark-products', width: 390, height: 844, locale: 'ar', theme: 'dark', workspace: 'products' },
    { id: '390-en-light-products', width: 390, height: 844, locale: 'en', theme: 'light', workspace: 'products' },
    { id: '390-ar-light-cart', width: 390, height: 844, locale: 'ar', theme: 'light', workspace: 'cart' },
    { id: '390-ar-light-payment', width: 390, height: 844, locale: 'ar', theme: 'light', workspace: 'payment' },
    { id: '430-ar-light-products', width: 430, height: 932, locale: 'ar', theme: 'light', workspace: 'products' },
    { id: '430-en-dark-cart', width: 430, height: 932, locale: 'en', theme: 'dark', workspace: 'cart' },
    { id: 'tablet-portrait-ar-light-products', width: 768, height: 1024, locale: 'ar', theme: 'light', workspace: 'products' },
    { id: 'tablet-portrait-ar-light-cart', width: 768, height: 1024, locale: 'ar', theme: 'light', workspace: 'cart' },
    { id: 'ipad-landscape-ar-light-products', width: 1180, height: 820, locale: 'ar', theme: 'light', workspace: 'products' },
    { id: 'ipad-landscape-en-dark-payment', width: 1180, height: 820, locale: 'en', theme: 'dark', workspace: 'payment' },
    { id: '1024-ar-light-products', width: 1024, height: 768, locale: 'ar', theme: 'light', workspace: 'products' },
    { id: '1024-en-light-cart', width: 1024, height: 768, locale: 'en', theme: 'light', workspace: 'cart' },
    { id: '1440-ar-light-products', width: 1440, height: 900, locale: 'ar', theme: 'light', workspace: 'products' },
    { id: '1440-ar-dark-products', width: 1440, height: 900, locale: 'ar', theme: 'dark', workspace: 'products' },
    { id: '1440-en-light-products', width: 1440, height: 900, locale: 'en', theme: 'light', workspace: 'products' },
    { id: '1440-en-dark-payment', width: 1440, height: 900, locale: 'en', theme: 'dark', workspace: 'payment' },
  ];

  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await applyAppearance(page, item);
    await openPosSellingWorkspace(page);
    await expect(page.getByPlaceholder(SEARCH)).toBeVisible();
    if (item.workspace !== 'products') {
      await addFirstProduct(page);
      if (item.width < 900) {
        await page.getByRole('button', { name: VIEW_CART }).click();
        await expect(page.getByTestId('pos-cart-lines')).toBeVisible();
      }
      if (item.workspace === 'payment') {
        await page.getByRole('button', { name: PAY }).first().click();
        await expect(page.getByTestId('pos-payment-screen')).toBeVisible();
      }
    }
    const file = `${item.id}.png`;
    await page.screenshot({ path: path.join(evidenceDir, file), fullPage: false });
    shots.push({ file, viewport: `${item.width}x${item.height}`, locale: item.locale, theme: item.theme, workspace: item.workspace });
    const measured = await measure(page);
    measurements.push({ id: item.id, ...measured });
    if (measured.overflow > 1) {
      findings.push({ severity: 'major', id: 'overflow', detail: `${item.id} horizontal overflow ${measured.overflow}px` });
    }
    for (const clipped of measured.clipped) {
      findings.push({ severity: 'major', id: 'clipped', detail: `${item.id} ${clipped}` });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await applyAppearance(page, { locale: 'ar', theme: 'light' });
  await openPosSellingWorkspace(page);
  const search = page.getByPlaceholder(SEARCH);
  await search.click();
  await search.fill('حبر');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(evidenceDir, '1440-ar-light-search.png'), fullPage: false });
  shots.push({ file: '1440-ar-light-search.png', viewport: '1440x900', locale: 'ar', theme: 'light', workspace: 'search' });
  await search.fill('');
  const before = await page.getByTestId('pos-cart-lines').locator('[data-testid="pos-cart-line-total"]').count();
  await search.click();
  await page.keyboard.type(BARCODE, { delay: 15 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const after = await page.getByTestId('pos-cart-lines').locator('[data-testid="pos-cart-line-total"]').count();
  if (after <= before) {
    findings.push({ severity: 'major', id: 'keyboard-wedge', detail: `typing ${BARCODE}+Enter did not add a cart line (${before} -> ${after})` });
  }
  await page.screenshot({ path: path.join(evidenceDir, '1440-ar-light-keyboard-wedge.png'), fullPage: false });
  shots.push({ file: '1440-ar-light-keyboard-wedge.png', viewport: '1440x900', locale: 'ar', theme: 'light', workspace: 'scanner-keyboard-wedge' });

  await page.keyboard.press('F4');
  const focused = await search.evaluate((node) => document.activeElement === node);
  if (!focused) findings.push({ severity: 'major', id: 'focus-f4', detail: 'F4 did not focus the product search' });

  const increase = page.getByRole('button', { name: INCREASE }).first();
  const beforeQty = await increase.locator('xpath=preceding-sibling::*[1]').innerText().catch(() => '');
  await increase.click();
  await page.screenshot({ path: path.join(evidenceDir, '1440-ar-light-qty.png'), fullPage: false });
  shots.push({ file: '1440-ar-light-qty.png', viewport: '1440x900', locale: 'ar', theme: 'light', workspace: 'quantity' });
  const qtyBox = await increase.boundingBox();
  if (!qtyBox || qtyBox.height < 44 || qtyBox.width < 44) {
    findings.push({ severity: 'major', id: 'touch-qty', detail: `increase control box ${JSON.stringify(qtyBox)} before=${beforeQty}` });
  }

  await page.getByTestId('pos-cart-pay').click();
  await expect(page.getByTestId('pos-payment-screen')).toBeVisible();
  const method = page.locator('[data-testid="pos-payment-screen"] button[aria-pressed]').first();
  const methodBox = await method.boundingBox();
  if (!methodBox || methodBox.height < 44) {
    findings.push({ severity: 'major', id: 'touch-method', detail: `method tile ${JSON.stringify(methodBox)}` });
  }
  const amount = page.getByTestId('pos-payment-screen').locator('input').first();
  await amount.fill('5000');
  await amount.blur();
  await page.waitForTimeout(200);
  const remaining = (await page.getByTestId('pos-payment-remaining').innerText()).replace(/\s+/g, ' ');
  const change = (await page.getByTestId('pos-payment-change').innerText()).replace(/\s+/g, ' ');
  const confirm = page.getByTestId('pos-confirm-payment');
  const confirmBox = await confirm.boundingBox();
  if (!confirmBox || confirmBox.height < 56) {
    findings.push({ severity: 'major', id: 'touch-confirm', detail: `confirm box ${JSON.stringify(confirmBox)}` });
  }
  if (await confirm.isDisabled()) {
    findings.push({ severity: 'note', id: 'confirm-disabled', detail: `confirm disabled after 5000. remaining="${remaining}" change="${change}"` });
  }
  await page.screenshot({ path: path.join(evidenceDir, '1440-ar-light-payment-amounts.png'), fullPage: false });
  shots.push({ file: '1440-ar-light-payment-amounts.png', viewport: '1440x900', locale: 'ar', theme: 'light', workspace: 'payment-amounts' });
  measurements.push({ id: 'payment-amounts', remaining, change, confirmEnabled: !(await confirm.isDisabled()) });

  await page.setViewportSize({ width: 390, height: 844 });
  await applyAppearance(page, { locale: 'ar', theme: 'light' });
  await openPosSellingWorkspace(page);
  await addFirstProduct(page);
  const bar = page.getByTestId('pos-transaction-bar');
  await expect(bar).toBeVisible();
  const barBox = await bar.boundingBox();
  const payBox = await page.getByRole('button', { name: PAY }).first().boundingBox();
  if (!payBox || payBox.height < 44) findings.push({ severity: 'major', id: 'touch-bar-pay', detail: JSON.stringify(payBox) });
  if (barBox && barBox.bottom > 844 + 1) findings.push({ severity: 'major', id: 'bar-offscreen', detail: JSON.stringify(barBox) });
  const safe = await bar.evaluate((node) => getComputedStyle(node).paddingBottom);
  measurements.push({ id: '390-bar', barBox, payBox, paddingBottom: safe });

  await writeFile(path.join(evidenceDir, 'measurements.json'), JSON.stringify({ shots, findings, measurements }, null, 2));
  expect(findings.filter((item) => item.severity === 'blocker' || item.severity === 'major'), JSON.stringify(findings, null, 2)).toEqual([]);
});

async function applyAppearance(page: Page, options: { locale: 'ar' | 'en'; theme: 'light' | 'dark' }) {
  await page.evaluate(({ locale, theme }) => {
    document.cookie = `locale=${locale};path=/;max-age=31536000;samesite=lax`;
    localStorage.setItem('theme', theme);
  }, options);
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('html')).toHaveAttribute('dir', options.locale === 'ar' ? 'rtl' : 'ltr');
  if (options.theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
  else await expect(page.locator('html')).not.toHaveClass(/dark/);
}

async function addFirstProduct(page: Page) {
  const product = page.locator('section button[aria-selected]').first();
  await expect(product).toBeVisible();
  await product.click();
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const clipped: string[] = [];
    const nodes = document.querySelectorAll('[data-testid="pos-cart-pay"], [data-testid="pos-confirm-payment"], [data-testid="pos-transaction-bar"] button, [data-testid="pos-category-strip"] button');
    nodes.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      if (r.left < -1 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1 || r.top < -1) {
        clipped.push(`${el.getAttribute('data-testid') || (el.textContent || '').trim().slice(0, 24)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dir: document.documentElement.dir,
      dark: document.documentElement.classList.contains('dark'),
      clipped,
    };
  });
}
