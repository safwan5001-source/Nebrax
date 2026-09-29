import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h1-5-scheduling-ux');

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function waitForBuilderReady(page: Page) {
  await page.waitForSelector('[data-experience-builder]');
  await page.waitForTimeout(400);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H1-5 — Scheduling UX', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  test('desktop 1440 AR — Schedule dialog names the version/store, shows date/time + authoritative timezone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=schedule-eligible');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    const scheduleButton = page.getByRole('button', { name: 'جدولة', exact: true });
    await expect(scheduleButton).toBeEnabled();
    await scheduleButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('جدولة «رمضان 1448»');
    await expect(dialog).toContainText('المتجر: متجر النور');
    await expect(dialog.locator('[data-schedule-date]')).toBeVisible();
    await expect(dialog.locator('[data-schedule-time]')).toBeVisible();
    await expect(dialog).toContainText('بتوقيت الرياض');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-schedule-dialog.png') });

    await dialog.locator('[data-schedule-date]').fill('2026-12-25');
    await dialog.locator('[data-schedule-time]').fill('21:00');
    await expect(dialog.locator('[data-schedule-preview]')).toContainText('رمضان 1448');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-schedule-preview.png') });

    await dialog.getByRole('button', { name: 'جدولة', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('تمت الجدولة');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-schedule-success.png') });

    // Publish Now is no longer offered on a version that just became Scheduled.
    await expect(page.getByRole('button', { name: 'نشر', exact: true })).toBeDisabled();
  });

  test('desktop 1440 EN — scheduling while another version is already scheduled shows the replace warning', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=scheduled');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByLabel('Design version being edited').click();
    const manager = page.getByRole('menu', { name: 'Manage design versions' });
    const draftRow = manager.getByText('رمضان 1448').locator('xpath=ancestor::li[1]');
    await draftRow.getByRole('button', { name: 'Open to edit' }).click();

    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-schedule-replace-warning]')).toContainText('عروض نهاية السنة');
    await expect(dialog.locator('[data-schedule-replace-warning]')).toContainText('cancels that one');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-en-replace-warning.png') });
  });

  test('desktop 1440 AR — Reschedule prefills the current time; Cancel schedule shows a lifecycle confirmation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=scheduled');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    const manager = page.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const scheduledRow = manager.getByText('عروض نهاية السنة').locator('xpath=ancestor::li[1]');
    await scheduledRow.getByRole('button', { name: 'إعادة الجدولة' }).click();

    const rescheduleDialog = page.getByRole('dialog');
    await expect(rescheduleDialog).toContainText('إعادة جدولة «عروض نهاية السنة»');
    // Seed is 2026-12-25T21:00:00Z — 21:00 UTC + 3h (Riyadh) rolls into the
    // next calendar day at midnight; the prefilled wall-clock fields must
    // reflect that exact Riyadh-local moment, not the UTC calendar date.
    await expect(rescheduleDialog.locator('[data-schedule-date]')).toHaveValue('2026-12-26');
    await expect(rescheduleDialog.locator('[data-schedule-time]')).toHaveValue('00:00');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-reschedule-prefilled.png') });
    await rescheduleDialog.getByRole('button', { name: 'إلغاء', exact: true }).click();

    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    await scheduledRow.getByRole('button', { name: 'إلغاء الجدولة' }).click();
    const cancelDialog = page.getByRole('dialog');
    await expect(cancelDialog).toContainText('إلغاء جدولة «عروض نهاية السنة»؟');
    await expect(cancelDialog).toContainText('لن يتم حذف هذه النسخة');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-cancel-schedule-confirm.png') });

    await cancelDialog.getByRole('button', { name: 'إلغاء الجدولة', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('أُلغيت الجدولة');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-cancel-schedule-success.png') });
  });

  test('desktop 1280 AR — Production runtime gate: Schedule disabled with explanation; Cancel remains available', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=scheduling-gated');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    // Two non-published candidates exist (a Draft and a Scheduled version) —
    // per the deterministic-selection rule (CUST-H1-2 §13) nothing auto-opens,
    // so the Draft is opened explicitly first to get a definite toolbar state.
    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    const manager = page.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await expect(manager.locator('[data-scheduling-gated-notice]')).toBeVisible();
    const draftRow = manager.getByText('رمضان 1448').locator('xpath=ancestor::li[1]');
    await draftRow.getByRole('button', { name: 'فتح للتعديل' }).click();

    const scheduleButton = page.getByRole('button', { name: 'جدولة', exact: true });
    await expect(scheduleButton).toBeDisabled();
    await expect(scheduleButton).toHaveAttribute('title', /لم يُفعَّل بعد/);

    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    const scheduledRow = manager.getByText('عروض نهاية السنة').locator('xpath=ancestor::li[1]');
    await expect(scheduledRow.getByRole('button', { name: 'إعادة الجدولة' })).toBeDisabled();
    await expect(scheduledRow.getByRole('button', { name: 'إلغاء الجدولة' })).toBeEnabled();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1280-ar-scheduling-gated.png') });
  });

  test('tablet 768 AR — schedule dialog fits without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=schedule-eligible');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);

    // The toolbar's own Schedule button is desktop-only (`lg:inline`) — the
    // toolbar is already at its 768px width budget with the version
    // selector, device switcher, Save and Publish (a real overflow Playwright
    // caught during this Horizon's own visual pass). Schedule stays fully
    // available at every width via the Version Manager, exactly like
    // Reschedule/Cancel already are.
    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    const manager = page.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const draftRow = manager.getByText('رمضان 1448').locator('xpath=ancestor::li[1]');
    await draftRow.getByRole('button', { name: 'جدولة', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'tablet-768-ar-schedule-dialog.png') });
  });

  test('tablet 1024 AR — a past date/time is rejected before any request, with a specific inline message', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=schedule-eligible');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByRole('button', { name: 'جدولة', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-schedule-date]').fill('2020-01-01');
    await dialog.locator('[data-schedule-time]').fill('09:00');

    await expect(dialog).toContainText('اختر وقتاً في المستقبل.');
    await expect(dialog.getByRole('button', { name: 'جدولة', exact: true })).toBeDisabled();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'tablet-1024-ar-schedule-past-rejected.png') });
  });

  test('desktop 1440 AR — long version name and long storefront name do not overflow the schedule dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=many-long-names');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    const manager = page.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const longRow = manager
      .getByText('نسخة تجربة إعادة تصميم موسم نهاية السنة', { exact: false })
      .locator('xpath=ancestor::li[1]');
    await longRow.getByRole('button', { name: 'فتح للتعديل' }).click();

    await page.getByRole('button', { name: 'جدولة', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-long-name-schedule-dialog.png') });
  });

  test('mobile 390 AR — Schedule from the bottom-sheet Version Manager closes the sheet and opens the dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=schedule-eligible');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);

    await page.locator('[data-version-selector-mobile]').click();
    const sheet = page.getByRole('dialog', { name: 'إدارة نسخ التصميم' });
    await expect(sheet).toBeVisible();
    const draftRow = sheet.getByText('رمضان 1448').locator('xpath=ancestor::li[1]');

    // أغلق طبقة أخطاء Next إن ظهرت (تحذير عابر غير متعلق بهذه الميزة) حتى لا
    // تبتلع النقرة التالية — نفس معالجة `pos-checkout-reliability.spec.ts`.
    await page.locator('[data-nextjs-dialog-overlay], nextjs-portal').evaluateAll((nodes) => {
      nodes.forEach((node) => ((node as HTMLElement).style.display = 'none'));
    }).catch(() => undefined);

    await draftRow.getByRole('button', { name: 'جدولة', exact: true }).click();

    await expect(page.getByRole('dialog', { name: 'إدارة نسخ التصميم' })).toHaveCount(0);
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText('جدولة «رمضان 1448»');
    await assertNoOverflow(page);
    const dateBox = await confirm.locator('[data-schedule-date]').boundingBox();
    expect(dateBox?.height ?? 0).toBeGreaterThanOrEqual(32); // touch-friendly tap target
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-ar-manager-schedule-dialog.png') });
  });

  test('mobile 430 EN — Scheduled state badge is visible and distinguishable by text, not color alone', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=scheduled');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);

    await page.locator('[data-version-selector-mobile]').click();
    const sheet = page.getByRole('dialog', { name: 'Manage design versions' });
    const scheduledRow = sheet.getByText('عروض نهاية السنة').locator('xpath=ancestor::li[1]');
    await expect(scheduledRow.getByText('Scheduled', { exact: true })).toBeVisible();
    await expect(scheduledRow).toContainText('Scheduled for');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-430-en-scheduled-badge.png') });
  });
});
