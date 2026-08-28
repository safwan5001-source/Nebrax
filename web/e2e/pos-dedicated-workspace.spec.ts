import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-550');

test.describe('PR-550 dedicated POS workspace', () => {
  test('Start selling opens /pos in a new tab and keeps ERP', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'new-tab contract is identical across projects');
    test.setTimeout(90_000);
    await mkdir(evidenceDir, { recursive: true });

    await page.goto('/login', { waitUntil: 'load' });
    await page.getByRole('button', { name: /دخول تجريبي|Demo login/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('button', { name: 'نقطة البيع' }).click();
    const start = page.getByRole('link', { name: /بدء البيع|Start selling/ });
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute('target', '_blank');
    await expect(start).toHaveAttribute('rel', 'noopener noreferrer');
    await page.screenshot({ path: path.join(evidenceDir, 'erp-sidebar-start-selling.png') });

    const popupPromise = context.waitForEvent('page');
    await start.click();
    const posPage = await popupPromise;
    await posPage.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /لوحة التحكم|Dashboard/ })).toBeVisible();
    await expect(posPage).toHaveURL(/\/pos\/?$/);
    await expect(posPage.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toHaveCount(0);
    await expect(posPage.getByRole('link', { name: /لوحة التحكم|Dashboard/ })).toHaveCount(0);
    await expect(posPage.getByRole('button', { name: /العودة للنظام|Return to system/ })).toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'erp-tab-stays-dashboard.png') });
    await posPage.screenshot({ path: path.join(evidenceDir, 'pos-tab-no-sidebar.png') });
  });
});
