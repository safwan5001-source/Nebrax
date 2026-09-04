import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fillAndSubmitOpenSellingSession, POS_OPEN_SESSION_TITLE } from './helpers/open-pos';

const evidenceDir = path.resolve(process.cwd(), '../docs/visual-qa/pr-550');

type DemoWindow = Window & {
  __POS_SESSIONS_FORCE_EMPTY?: boolean;
  __POS_OPEN_FAIL?: boolean;
};

async function enterDemo(page: Page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.getByRole('button', { name: /دخول تجريبي|Demo login/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function openStartFromSidebar(page: Page) {
  await page.getByRole('button', { name: 'نقطة البيع' }).click();
  const start = page.getByRole('link', { name: /بدء البيع|Start selling/ });
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute('href', '/pos/start');
  await expect(start).not.toHaveAttribute('target', '_blank');
  return start;
}

function livePages(context: { pages: () => Page[] }) {
  return context.pages().filter((item) => !item.isClosed());
}

function posWorkspacePages(context: { pages: () => Page[] }) {
  return livePages(context).filter((item) => {
    try {
      return /\/pos\/?$/.test(new URL(item.url()).pathname);
    } catch {
      return false;
    }
  });
}

test.describe('PR-550 dedicated POS workspace', () => {
  test('Start selling opens /pos/start in the same tab; POS opens in a new tab after session', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'new-tab contract is identical across projects');
    test.setTimeout(90_000);
    await mkdir(evidenceDir, { recursive: true });

    await enterDemo(page);
    const start = await openStartFromSidebar(page);
    await page.screenshot({ path: path.join(evidenceDir, 'erp-sidebar-start-selling.png') });

    await start.click();
    await expect(page).toHaveURL(/\/pos\/start\/?/);
    await expect(page.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: POS_OPEN_SESSION_TITLE })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(evidenceDir, 'erp-tab-stays-on-start.png') });

    const resume = page.getByTestId('pos-resume-selling');
    const popupPromise = context.waitForEvent('page');
    if (await resume.isVisible().catch(() => false)) {
      await expect(page.getByRole('button', { name: /فتح الجلسة وبدء البيع|Open Session & Start Selling/ })).toHaveCount(0);
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
    expect(livePages(context)).toHaveLength(2);
    expect(posWorkspacePages(context)).toHaveLength(1);

    await page.screenshot({ path: path.join(evidenceDir, 'erp-tab-stays-start-after-open.png') });
    await posPage.screenshot({ path: path.join(evidenceDir, 'pos-tab-no-sidebar.png') });
  });

  test('successful session creation opens /pos in a new tab and keeps /pos/start', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'new-tab contract is identical across projects');
    test.setTimeout(90_000);

    await page.addInitScript(() => {
      (window as DemoWindow).__POS_SESSIONS_FORCE_EMPTY = true;
    });
    await enterDemo(page);
    await page.goto('/pos/start', { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: POS_OPEN_SESSION_TITLE })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pos-resume-selling')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toBeVisible();

    const popupPromise = context.waitForEvent('page');
    await fillAndSubmitOpenSellingSession(page);
    const posPage = await popupPromise;
    await posPage.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/\/pos\/start\/?/);
    await expect(page.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toBeVisible();
    await expect(posPage).toHaveURL(/\/pos\/?$/);
    await expect(posPage.getByRole('button', { name: /طيّ الشريط|Collapse sidebar/ })).toHaveCount(0);
    await expect(posPage.getByRole('button', { name: /العودة للنظام|Return to system/ })).toBeVisible({ timeout: 30_000 });
    await expect(posPage.getByPlaceholder(/ابحث بالاسم|Search by name|ابحث في المنتجات|Search products/)).toBeVisible();
    expect(livePages(context)).toHaveLength(2);
    expect(posWorkspacePages(context)).toHaveLength(1);
  });

  test('failed session open does not leave an orphan POS tab', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'new-tab contract is identical across projects');
    test.setTimeout(90_000);

    await page.addInitScript(() => {
      (window as DemoWindow).__POS_SESSIONS_FORCE_EMPTY = true;
      (window as DemoWindow).__POS_OPEN_FAIL = true;
    });
    await enterDemo(page);
    await page.goto('/pos/start', { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: POS_OPEN_SESSION_TITLE })).toBeVisible({ timeout: 30_000 });

    const pagesBefore = livePages(context).length;
    await fillAndSubmitOpenSellingSession(page);
    await expect(page.getByText(/تعذر فتح الجلسة|تعذّر الحفظ|Could not save/)).toBeVisible();
    await expect(page).toHaveURL(/\/pos\/start\/?/);
    await expect(page.getByRole('button', { name: /فتح الجلسة وبدء البيع|Open Session & Start Selling/ })).toBeVisible();
    await expect(page.locator('#pos-open-device')).toHaveValue(/.+/);
    await expect.poll(() => livePages(context).length).toBe(pagesBefore);
    expect(posWorkspacePages(context)).toHaveLength(0);
  });
});
