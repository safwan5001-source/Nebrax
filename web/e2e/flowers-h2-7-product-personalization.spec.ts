import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, productPageHandler, seedAdmin, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-7 — التحقق البصري لقسم «تخصيص المنتج». الخادم مُعترَض بحمولات تطابق عقد
 * `commerce/workspace/products/{id}/personalization` (استبدال كامل بالمفتاح).
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-7-product-personalization');
});

type Row = Record<string, unknown>;
const FIELDS: Row[] = [
  { key: 'card-name', type: 'text', label: 'الاسم على البطاقة', label_en: 'Card name', help_text: 'حتى 20 حرفاً', is_required: true, max_length: 20, is_active: true, options: [] },
  { key: 'message', type: 'textarea', label: 'رسالة خاصة تُطبع داخل صندوق الهدية مع العبارة المميزة', label_en: null, help_text: null, is_required: false, max_length: 250, is_active: true, options: [] },
  { key: 'ribbon', type: 'select', label: 'لون الشريط', label_en: 'Ribbon colour', help_text: null, is_required: false, max_length: null, is_active: false,
    options: [{ value_key: 'red', label: 'أحمر', label_en: 'Red', is_active: true }, { value_key: 'gold', label: 'ذهبي', label_en: null, is_active: true }] },
];

function server(state: { fields: Row[]; fail?: 'save' | 'load' }) {
  return productPageHandler(async (url: string, route: Route) => {
    if (url.includes('/products/p1/preparation')) {
      await route.fulfill({ json: { data: { preparation_minutes: null } } });
      return true;
    }
    if (!url.includes('/products/p1/personalization')) return false;
    if (route.request().method() === 'GET') {
      if (state.fail === 'load') await route.fulfill({ status: 500, json: { message: 'x' } });
      else await route.fulfill({ json: { data: { fields: state.fields } } });
      return true;
    }
    if (state.fail === 'save') {
      await route.fulfill({ status: 422, json: { message: 'مفاتيح مُدخَلات التخصيص يجب أن تكون فريدة.' } });
      return true;
    }
    state.fields = (route.request().postDataJSON() as { fields: Row[] }).fields.map((f) => ({ label_en: null, help_text: null, max_length: null, options: [], ...f }));
    await route.fulfill({ json: { data: { fields: state.fields } } });
    return true;
  });
}

const TAB = { ar: 'الهدايا والتخصيص', en: 'Gifting' } as const;
const PERS = { ar: 'تخصيص المنتج', en: 'Product personalization' } as const;

test.describe('FLOWERS-H2-7 — product personalization', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — list, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server({ fields: FIELDS }));
        await page.goto('/products/p1');
        await page.getByRole('tab', { name: TAB[locale] }).click();
        await page.getByRole('tab', { name: PERS[locale] }).click();
        await expect(page.locator('[data-personalization-row]')).toHaveCount(3);
        await assertNoOverflow(page);
        await page.locator('[data-personalization-section]').screenshot({ path: path.join(dir, `${locale}-${w}-list.png`) });
      });
    }
  }

  test('AR 390 — editor dialog for a select: options, key lock, preview; apply then save', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { fields: FIELDS };
    await seedAdmin(page, 'ar', server(state));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: TAB.ar }).click();
    await page.getByRole('tab', { name: PERS.ar }).click();
    await page.getByRole('button', { name: 'تعديل: لون الشريط' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-personalization-preview]')).toBeVisible();
    await expect(dialog.getByLabel('المعرّف', { exact: true })).toBeDisabled();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-select-editor.png') });
    await dialog.getByRole('switch', { name: 'نشط (يظهر للمتسوّق)' }).click();
    await dialog.getByRole('button', { name: 'تطبيق على القائمة' }).click();
    await expect(page.getByText('تغييرات غير محفوظة')).toBeVisible();
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.locator('[data-personalization-section]').getByText('كل التعديلات محفوظة')).toBeVisible();
    expect((state.fields.find((f) => f.key === 'ribbon') as Row).is_active).toBe(true);
    await page.screenshot({ path: path.join(dir, 'ar-390-saved.png'), fullPage: true });
  });

  test('AR 390 — add a field: validation, apply, new badge, cart warning', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'ar', server({ fields: FIELDS }));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: TAB.ar }).click();
    await page.getByRole('tab', { name: PERS.ar }).click();
    await page.getByRole('button', { name: 'إضافة مُدخَل' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'تطبيق على القائمة' }).click();
    await expect(dialog.getByText('هذا الحقل مطلوب.')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-add-invalid.png') });
    await dialog.getByLabel('عنوان المُدخَل').fill('تاريخ المناسبة');
    await dialog.getByRole('button', { name: 'تطبيق على القائمة' }).click();
    await expect(page.locator('[data-personalization-row]')).toHaveCount(4);
    await expect(page.getByText(/قد يُعيد سلته للمراجعة/)).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-added.png'), fullPage: true });
  });

  test('EN 1440 — keyboard: dialog fields reachable, Escape closes; server rejection keeps draft', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const state = { fields: FIELDS, fail: 'save' as 'save' | 'load' | undefined };
    await seedAdmin(page, 'en', server(state));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByRole('tab', { name: PERS.en }).click();
    await page.getByRole('button', { name: 'Edit: الاسم على البطاقة' }).click();
    const title = page.getByRole('dialog').getByLabel('Input title');
    await expect(title).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Move down: الاسم على البطاقة' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'فريدة' })).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-server-error.png'), fullPage: true });
  });

  test('EN 1440 — leaving the Gifting tab with an unsaved draft asks first; declining keeps the draft', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', server({ fields: FIELDS }));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByRole('tab', { name: PERS.en }).click();
    await page.getByRole('button', { name: 'Move down: الاسم على البطاقة' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    const messages: string[] = [];
    page.once('dialog', (d) => { messages.push(d.message()); void d.dismiss(); });
    await page.getByRole('tab').first().click();
    await expect(page.getByText('Unsaved changes')).toBeVisible(); // رُفض التجاهل ⇒ بقينا في تبويب الهدايا بمسوّدتنا
    expect(messages[0]).toMatch(/unsaved changes/i);

    page.once('dialog', (d) => { void d.accept(); });
    await page.getByRole('tab').first().click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  });

  test('EN 390 read-only + empty state; dark', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ fields: FIELDS }), { permissions: ['products.view', 'commerce.manage'], role: 'staff' });
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByRole('tab', { name: PERS.en }).click();
    await expect(page.getByRole('button', { name: 'Add input' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^View input/ }).first()).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-readonly.png'), fullPage: true });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'en', server({ fields: [] }), { dark: true });
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByRole('tab', { name: PERS.en }).click();
    await expect(page.getByText('No personalization inputs')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-390-dark-empty.png'), fullPage: true });
  });
});
