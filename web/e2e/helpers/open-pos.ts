import { expect, type Page } from '@playwright/test';

export const POS_SEARCH = /ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/;
export const POS_OPEN_SESSION_TITLE = /فتح جلسة بيع|Open Selling Session/;
export const POS_OPEN_SESSION_SUBMIT = /فتح الجلسة وبدء البيع|Open Session & Start Selling/;

export async function fillAndSubmitOpenSellingSession(page: Page) {
  const device = page.locator('#pos-open-device');
  if (await device.isEnabled().catch(() => false)) {
    const options = await device.locator('option').allTextContents();
    const firstReal = options.find((label) => label.trim() && !/select|اختر/i.test(label));
    if (firstReal) await device.selectOption({ label: firstReal });
  }
  const shift = page.locator('#pos-open-shift');
  if (await shift.isEnabled().catch(() => false)) {
    const options = await shift.locator('option').allTextContents();
    const firstReal = options.find((label) => label.trim() && !/select|اختر|وردية نقاط|POS shift/i.test(label));
    if (firstReal) await shift.selectOption({ label: firstReal });
  }
  await page.locator('#pos-open-opening-cash').fill('0');
  await page.getByRole('button', { name: POS_OPEN_SESSION_SUBMIT }).click();
}

/** يدخل مساحة البيع: يستأنف الجلسة القائمة أو يفتح واحدة عبر /pos/start. */
export async function openPosSellingWorkspace(page: Page) {
  await page.goto('/pos', { waitUntil: 'load' });
  const search = page.getByPlaceholder(POS_SEARCH);
  const startTitle = page.getByRole('heading', { name: POS_OPEN_SESSION_TITLE });
  await expect(search.or(startTitle)).toBeVisible({ timeout: 30_000 });
  if (await startTitle.isVisible().catch(() => false) && !(await search.isVisible().catch(() => false))) {
    await fillAndSubmitOpenSellingSession(page);
  }
  await expect(page.getByPlaceholder(POS_SEARCH)).toBeVisible({ timeout: 30_000 });
}
