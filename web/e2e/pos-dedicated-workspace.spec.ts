import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fillAndSubmitOpenSellingSession, POS_OPEN_SESSION_TITLE } from './helpers/open-pos';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-550');

test.describe('PR-550 dedicated POS workspace', () => {
  test('Start selling opens /pos/start in the same tab; POS opens in a new tab after session', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'new-tab contract is identical across projects');
    test.setTimeout(90_000);
    await mkdir(evidenceDir, { recursive: true });

    await page.goto('/login', { waitUntil: 'load' });
    await page.getByRole('button', { name: /دخول تجريبي|Demo login/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('button', { name: 'نقطة البيع' }).click();
    const start = page.getByRole('link', { name: /بدء البيع|Start selling/ });
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute('href', '/pos/start');
    await expect(start).not.toHaveAttribute('target', '_blank');
    await page.screenshot({ path: path.join(evidenceDir, 'erp-sidebar-start-selling.png') });

    await start.click();
    await expect(page).toHaveURL(/\/pos\/start\/?/);
    await expect(page.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: POS_OPEN_SESSION_TITLE })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(evidenceDir, 'erp-tab-stays-on-start.png') });

    const resume = page.getByTestId('pos-resume-selling');
    const popupPromise = context.waitForEvent('page');
    if (await resume.isVisible().catch(() => false)) {
      await resume.click();
    } else {
      await fillAndSubmitOpenSellingSession(page);
    }
    const posPage = await popupPromise;
    await posPage.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/\/pos\/start\/?/);
    await expect(page.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toBeVisible();
    await expect(posPage).toHaveURL(/\/pos\/?$/);
    await expect(posPage.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toHaveCount(0);
    await expect(posPage.getByRole('link', { name: /لوحة التحكم|Dashboard/ })).toHaveCount(0);
    await expect(posPage.getByRole('button', { name: /العودة للنظام|Return to system/ })).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: path.join(evidenceDir, 'erp-tab-stays-start-after-open.png') });
    await posPage.screenshot({ path: path.join(evidenceDir, 'pos-tab-no-sidebar.png') });
  });
});
