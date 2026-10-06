import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, productPageHandler, seedAdmin, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-9 — التحقق البصري لقسم «محتوى المنتج». الخادم مُعترَض بحمولات تطابق عقد
 * `commerce/workspace/products/{id}/content` (استبدال كامل، كتلة لكل نوع).
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-9-product-content');
});

type Row = Record<string, unknown>;
const BLOCKS: Row[] = [
  { block_type: 'composition', body: '٢٤ وردة جورية حمراء بطول ٥٠ سم مع أوراق الأوكالبتوس والجبسوفيلا، مغلّفة بورق كرافت فاخر وشريط ساتان باللون الأحمر.', body_en: '24 red roses, 50 cm', is_active: true },
  { block_type: 'care', body: 'تُوضع في ماء بارد وتُقصّ السيقان بزاوية كل يومين.\nتُبعد عن أشعة الشمس المباشرة.', body_en: null, is_active: true },
  { block_type: 'allergens', body: 'قد تسبب حساسية لمن يعانون من حبوب اللقاح.', body_en: null, is_active: false },
];

function server(state: { blocks: Row[]; failSave?: boolean }) {
  return productPageHandler(async (url: string, route: Route) => {
    if (url.includes('/products/p1/preparation')) {
      await route.fulfill({ json: { data: { preparation_minutes: null } } });
      return true;
    }
    if (!url.includes('/commerce/workspace/products/p1/content')) return false;
    if (route.request().method() === 'PUT') {
      if (state.failSave) {
        await route.fulfill({ status: 422, json: { message: 'نص كتلة المحتوى يتجاوز الحد المسموح.' } });
        return true;
      }
      state.blocks = (route.request().postDataJSON() as { blocks: Row[] }).blocks;
    }
    await route.fulfill({ json: { data: { blocks: state.blocks } } });
    return true;
  });
}

const TAB = { ar: 'الهدايا والتخصيص', en: 'Gifting' } as const;
const SECTION = { ar: /^المحتوى/, en: /^Content/ } as const;

async function open(page: import('@playwright/test').Page, locale: 'ar' | 'en') {
  await page.goto('/products/p1');
  await page.getByRole('tab', { name: TAB[locale] }).click();
  await page.getByRole('tab', { name: SECTION[locale] }).click();
}

test.describe('FLOWERS-H2-9 — structured product content', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — list, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server({ blocks: BLOCKS }));
        await open(page, locale);
        await expect(page.locator('[data-content-row]')).toHaveCount(3);
        await assertNoOverflow(page);
        await page.locator('[data-content-section]').screenshot({ path: path.join(dir, `${locale}-${w}-list.png`) });
      });
    }
  }

  test('AR 390 — add: closed type list, guidance, counter, validation, apply, save', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { blocks: BLOCKS };
    await seedAdmin(page, 'ar', server(state));
    await open(page, 'ar');
    await page.getByRole('button', { name: 'إضافة محتوى' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('نوع المحتوى').locator('option')).toHaveCount(7);
    await dialog.getByLabel('نوع المحتوى').selectOption('storage');
    await expect(dialog.getByText('ظروف الحفظ والتخزين قبل التسليم وبعده.')).toBeVisible();
    await dialog.getByRole('button', { name: 'تطبيق على القائمة' }).click();
    await expect(dialog.getByText('هذا الحقل مطلوب.')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-add-invalid.png') });
    await dialog.getByLabel('النص', { exact: true }).fill('يُحفظ في مكان بارد وجاف.');
    await expect(dialog.getByText(/23 \/ 2000|٢٣|\/ 2000/)).toBeVisible();
    await assertNoOverflow(page);
    await dialog.getByRole('button', { name: 'تطبيق على القائمة' }).click();
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.locator('[data-content-section]').getByText('كل التعديلات محفوظة')).toBeVisible();
    expect(state.blocks.map((b) => b.block_type)).toEqual(['composition', 'care', 'allergens', 'storage']);
    await page.screenshot({ path: path.join(dir, 'ar-390-saved.png'), fullPage: true });
  });

  test('EN 1440 — too many lines refused locally; server rejection stays visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const state = { blocks: BLOCKS, failSave: true };
    await seedAdmin(page, 'en', server(state));
    await open(page, 'en');
    await page.getByRole('button', { name: 'Edit: Care' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Text', { exact: true }).fill(Array.from({ length: 41 }, (_, i) => `line ${i}`).join('\n'));
    await dialog.getByRole('button', { name: 'Apply to list' }).click();
    await expect(dialog.getByText('Too many lines (maximum 40).')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-lines.png') });
    await dialog.getByLabel('Text', { exact: true }).fill('ok');
    await dialog.getByRole('button', { name: 'Apply to list' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'يتجاوز الحد' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-server-error.png'), fullPage: true });
  });

  test('EN 390 read-only; dark empty', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ blocks: BLOCKS }), { permissions: ['products.view', 'commerce.manage'], role: 'staff' });
    await open(page, 'en');
    await expect(page.getByRole('button', { name: 'Add content' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-readonly.png'), fullPage: true });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'en', server({ blocks: [] }), { dark: true });
    await open(page, 'en');
    await expect(page.getByText('No content yet')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-390-dark-empty.png'), fullPage: true });
  });
});
