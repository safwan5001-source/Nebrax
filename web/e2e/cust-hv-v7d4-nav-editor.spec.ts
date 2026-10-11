import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V7d-4 — the header-menu editor in the real builder (demo mode, mock catalogue): the explicit switch from the legacy links,
 * adding items through the picker (home / external / category), Make child ↴ / Move out ↰, the dropdown toggle on a parent, and the Canvas reflecting every edit.
 * AR RTL + EN LTR; no horizontal overflow; every control stays inside the viewport.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v7d4');

async function assertNoOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s).toBeLessThanOrEqual(o.c + 1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-HV V7d-4 — navigation editor', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const width of [1024, 1280, 1440]) {
      test(`${locale} @ ${width}`, async ({ page }) => {
        const ar = locale === 'ar';
        await page.setViewportSize({ width, height: 960 });
        await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('[data-experience-builder]');
        await page.waitForTimeout(400);
        await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });

        await page.locator('[data-panel-option="header"]').click();
        await page.locator('[data-nav-migrate]').click();
        const editor = page.locator('[data-nav-panel-editor]');
        await expect(editor).toBeVisible();

        // add two items through the picker (home), then an external link
        for (let i = 0; i < 2; i++) {
          await editor.getByRole('button', { name: ar ? 'إضافة عنصر' : 'Add item' }).click();
          const picker = page.locator('[data-nav-picker]');
          await expect(picker).toBeVisible();
          await expect(picker).toBeFocused(); // the picker takes focus
          await picker.getByRole('button', { name: ar ? 'الرئيسية' : 'Home' }).first().click();
        }
        await editor.getByRole('button', { name: ar ? 'إضافة عنصر' : 'Add item' }).click();
        const picker = page.locator('[data-nav-picker]');
        await picker.getByRole('tab', { name: ar ? 'رابط خارجي' : 'External link' }).click();
        await picker.getByPlaceholder('https://').fill('https://example.com/blog');
        await picker.getByRole('button', { name: ar ? 'استخدام الرابط' : 'Use link' }).click();
        await expect(editor.locator('[data-nav-row]')).toHaveCount(3);

        // the category tab lists the (mock) catalogue; Escape leaves without adding
        await editor.getByRole('button', { name: ar ? 'إضافة عنصر' : 'Add item' }).click();
        const catPicker = page.locator('[data-nav-picker]');
        await catPicker.getByRole('tab', { name: ar ? 'تصنيف' : 'Category' }).click();
        await expect(catPicker.getByRole('option').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-nav-picker]')).toHaveCount(0);
        await expect(editor.locator('[data-nav-row]')).toHaveCount(3);

        // name the items (label-less items are flagged), then nest the second under the first
        const labels = editor.getByRole('textbox', { name: ar ? 'نص العنصر' : 'Item text' });
        await expect(editor.locator('[data-nav-problem="navLabelEmpty"]')).toHaveCount(0); // prefilled labels
        await labels.nth(0).fill(ar ? 'المتجر' : 'Shop');
        await labels.nth(1).fill(ar ? 'الورود' : 'Roses');
        await labels.nth(2).fill(ar ? 'المدونة' : 'Blog');
        await editor.locator('[data-nav-row]').nth(1).getByRole('button', { name: ar ? 'اجعله فرعاً ↴' : 'Make child ↴' }).click();
        await expect(editor.locator('[data-nav-child-row]')).toHaveCount(1);
        await expect(editor.getByRole('checkbox', { name: ar ? 'عرض الفروع كقائمة منسدلة' : 'Show children as a dropdown' })).toBeChecked();

        // the Canvas reflects the edits: dropdown parent + blog link in the rail
        const canvas = page.locator('[data-preview-canvas]');
        await expect(canvas.locator('[data-nav-dropdown]')).toHaveCount(1);
        const railLabels = await canvas.locator('[data-extra-nav]').allTextContents();
        expect(railLabels.map((l) => l.trim())).toEqual([ar ? 'المتجر' : 'Shop', ar ? 'المدونة' : 'Blog']);

        await assertNoOverflow(page);
        // every control of the first row stays inside the viewport
        const inside = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll('[data-nav-row] button, [data-nav-row] input, [data-nav-row] select')].every((el) => {
            const r = el.getBoundingClientRect();
            return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5);
          });
        });
        expect(inside).toBe(true);
        await page.screenshot({ path: path.join(evidenceDir, `nav-editor-${locale}-${width}.png`) });
      });
    }
  }
});
