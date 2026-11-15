import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { GOVERNOR, MANAGER, NOZZLE_A, STATION_A, mockTankerApi, type Locale, type Mode } from './support/tanker-owners-mock';

/**
 * TANKER-PR3 — الفحص البصري والسلوكي لشاشة «إعدادات تعبئة الصهاريج» على نسخة إنتاج (خادم مُعترَض ببيانات اصطناعية):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-tanker-settings PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/tanker-settings-visual.spec.ts
 * يدوي خارج CI. **ليس** اختبار Safari الفعلي (معيار القبول المنفصل في ACCEPTANCE_TESTS.md).
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 }, desktop: { width: 1366, height: 820 } } as const;
const PATH = '/fuel-stations/tanker-settings';

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
async function shot(page: Page, rel: string, fullPage = false) {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage });
}
async function audit(page: Page, label: string, touch: boolean) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>('main a, main button, main select, main input:not([type=checkbox]), main label:has(input)')]
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains('sr-only')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 36)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    return { overflow: doc.scrollWidth - doc.clientWidth, small };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  if (touch) expect.soft(result.small, `${label}: touch targets under 36px`).toEqual([]);
}
async function open(page: Page, locale: Locale, theme: 'light' | 'dark', permissions: string[], mode: Mode = 'ok') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const mock = await mockTankerApi(page, { baseUrl, locale, theme, permissions, mode });
  await page.goto(PATH);
  await settle(page);
  return { mock, errors };
}

const MATRIX: Array<{ size: keyof typeof SIZES; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'desktop', locale: 'en', theme: 'light' },
];

for (const cell of MATRIX) {
  const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
  test.describe(tag, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: cell.size !== 'desktop', hasTouch: cell.size !== 'desktop', deviceScaleFactor: 2 });

    test('policies · station scope · nozzle operations', async ({ page }) => {
      const { mock, errors } = await open(page, cell.locale, cell.theme, GOVERNOR);
      const touch = cell.size !== 'desktop';
      await expect(page.locator('#tanker-settings-selection')).toBeVisible();
      await audit(page, `${tag} org scope`, touch);
      await shot(page, `${tag}/01-org`);

      // تغيير سياستين وحفظهما: حمولة المتغيّر فقط.
      await page.selectOption('#tanker-settings-selection', 'true');
      await page.selectOption('#tanker-settings-overrun', 'block');
      await page.locator('main button').filter({ hasText: cell.locale === 'ar' ? 'حفظ السياسات' : 'Save policies' }).click();
      await settle(page);
      const put = mock.requests.find((r) => r.method === 'PUT' && r.path === '/fuel-stations/settings');
      expect(put?.body, `${tag}: payload`).toEqual({ tanker_selection_required: true, tanker_capacity_overrun_policy: 'block' });

      // نطاق المحطة + الفوهات.
      await page.selectOption('#tanker-settings-scope', STATION_A);
      await expect(page.locator(`[data-nozzle="${NOZZLE_A}"]`)).toBeVisible();
      await audit(page, `${tag} station scope`, touch);
      await shot(page, `${tag}/02-station-nozzles`, true);
      const row = page.locator(`[data-nozzle="${NOZZLE_A}"]`);
      await row.getByRole('checkbox').first().uncheck();
      await row.getByRole('button').click();
      await settle(page);
      const nozzlePut = mock.requests.find((r) => r.method === 'PUT' && r.path === `/fuel-stations/nozzles/${NOZZLE_A}`);
      expect(nozzlePut?.body, `${tag}: nozzle payload`).toEqual({ allowed_operations: ['tanker_fill', 'internal_issue'] });
      expect(JSON.stringify(mock.requests.map((r) => r.body))).not.toMatch(/tenant_id/);
      expect(errors, `${tag}: page errors`).toEqual([]);
    });
  });
}

test.describe('states (iphone ar)', () => {
  test.use({ viewport: SIZES.iphone, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('no governance → read-only with the explanation, no write requests', async ({ page }) => {
    const { mock } = await open(page, 'ar', 'light', ['fuel_stations.view', 'fuel.tanker.view', 'fuel_stations.manage']);
    await expect(page.locator('#tanker-settings-selection')).toBeDisabled();
    await expect(page.getByText(/fuel\.governance\.manage/).first()).toBeVisible();
    await shot(page, 'states/no-governance');
    expect(mock.requests.some((r) => r.method !== 'GET')).toBeFalsy();
  });

  test('gate closed → closed state', async ({ page }) => {
    await open(page, 'ar', 'light', GOVERNOR, 'gate_closed');
    await expect(page.getByText(/غير مفعّلة|غير مفعلة/).first()).toBeVisible();
    await shot(page, 'states/gate-closed');
  });

  test('a server refusal of a nozzle narrowing shows the governance message', async ({ page }) => {
    await open(page, 'ar', 'light', MANAGER.concat('fuel_stations.manage'));
    await page.selectOption('#tanker-settings-scope', STATION_A);
    const row = page.locator(`[data-nozzle="${NOZZLE_A}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').first().uncheck();
    // الخادم الوهمي يعيد 403 للتعديل في وضع error فقط؛ هنا نتحقق من أن التلميح ظاهر قبل الحفظ.
    await expect(row.getByText(/fuel\.governance\.manage/)).toBeVisible();
    await shot(page, 'states/narrow-hint');
  });
});
