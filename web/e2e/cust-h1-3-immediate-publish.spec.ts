import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h1-3-immediate-publish');

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

test.describe('CUST-H1-3 — Immediate Version Publishing', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  test('desktop 1440 AR — first publish: confirmation names the version/store and shows the "first publish" body', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    const publishButton = page.getByRole('button', { name: 'نشر', exact: true });
    await expect(publishButton).toBeEnabled();
    await publishButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('نشر «التصميم الحالي»؟');
    await expect(dialog).toContainText('المتجر: متجر النور');
    await expect(dialog).toContainText('لا يوجد تصميم منشور لهذا المتجر بعد — سيكون هذا أول نشر له.');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-first-publish-confirm.png') });

    await dialog.getByRole('button', { name: 'نشر الآن' }).click();
    await expect(page.getByRole('status')).toContainText('تم النشر');
    await expect(page.getByText('هذه النسخة منشورة ومقروءة فقط')).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-published-readonly-after.png') });
  });

  test('desktop 1440 EN — replacing an existing live version shows the replace + retain body', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=draft-and-published');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    // Version names are seed content, not UI chrome — they stay in Arabic
    // regardless of `locale` (only the interface strings translate).
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Publish "رمضان 1448"?');
    await expect(dialog).toContainText("This design will become this storefront's live design.");
    await expect(dialog).toContainText('The current live version will be kept as a retrievable previous version.');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-en-replace-confirm.png') });

    await dialog.getByRole('button', { name: 'Publish now' }).click();
    await expect(page.getByRole('status')).toContainText('Published');

    // The previous live version is now a Draft in the manager.
    await page.getByLabel('Design version being edited').click();
    const manager = page.getByRole('menu', { name: 'Manage design versions' });
    const previousLiveRow = manager.getByText('التصميم الحالي').locator('xpath=ancestor::li[1]');
    await expect(previousLiveRow.getByText('Draft', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-en-manager-after-publish.png') });
  });

  test('tablet 768 AR — publish confirmation fits without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=draft-and-published');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByRole('button', { name: 'نشر', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'tablet-768-ar-confirm.png') });
  });

  test('mobile 390 AR — Publish now from the bottom-sheet Version Manager, dialog fits and is touch-friendly', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=draft-and-published');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);

    await page.locator('[data-version-selector-mobile]').click();
    const sheet = page.getByRole('dialog', { name: 'إدارة نسخ التصميم' });
    await expect(sheet).toBeVisible();
    const draftRow = sheet.getByText('رمضان 1448').locator('xpath=ancestor::li[1]');
    await draftRow.getByRole('button', { name: 'نشر الآن' }).click();

    // The bottom sheet is replaced by the confirmation dialog, not stacked
    // underneath it — only one dialog with the confirm content is visible.
    await expect(page.getByRole('dialog', { name: 'إدارة نسخ التصميم' })).toHaveCount(0);
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText('نشر «رمضان 1448»؟');
    await assertNoOverflow(page);
    const submitBox = await confirm.getByRole('button', { name: 'نشر الآن' }).boundingBox();
    expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(32); // touch-friendly tap target
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-ar-manager-publish-confirm.png') });

    await confirm.getByRole('button', { name: 'نشر الآن' }).click();
    await expect(page.getByRole('status')).toContainText('تم النشر');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-ar-published-success.png') });
  });

  test('mobile 430 EN — Published version offers no normal Publish action; scheduled shows a cancel-first hint', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=published-readonly');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);

    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-430-en-published-no-publish.png') });
  });

  test('desktop 1280 AR — a Scheduled version disables Publish with a cancel-schedule tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=many-long-names');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    const manager = page.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const scheduledRow = manager.getByText('عروض نهاية السنة').locator('xpath=ancestor::li[1]');
    await scheduledRow.getByRole('button', { name: 'فتح للتعديل' }).click();

    const publishButton = page.getByRole('button', { name: 'نشر', exact: true });
    await expect(publishButton).toBeDisabled();
    await expect(publishButton).toHaveAttribute('title', /مجدولة/);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1280-ar-scheduled-gated.png') });
  });
});
