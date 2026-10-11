import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V7e-3 — the footer editor in the real builder (demo mode, mock catalogue): choose a layout, add a group and links through the
 * pickers, set a designed background, and watch the Canvas follow each edit; nothing overflows and every control stays inside the viewport.
 * AR RTL + EN LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v7e3');

async function assertNoOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s).toBeLessThanOrEqual(o.c + 1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-HV V7e-3 — footer editor', () => {
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
        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });

        await page.locator('[data-panel-option="footer"]').click();
        const editor = page.locator('[data-footer-editor]');
        await expect(editor).toBeVisible();

        // layout
        await editor.locator('[data-footer-layout-select]').selectOption('columns');
        await expect(page.locator('[data-preview-canvas] footer')).toHaveAttribute('data-footer-layout', 'columns');

        // a group with two links through the picker
        await editor.getByRole('button', { name: ar ? 'إضافة مجموعة' : 'Add group' }).click();
        await editor.getByRole('textbox', { name: ar ? 'عنوان المجموعة' : 'Group title' }).fill(ar ? 'معلومات' : 'Info');
        await editor.getByRole('button', { name: ar ? 'إضافة رابط' : 'Add link' }).click();
        const picker = page.locator('[data-nav-picker]');
        await expect(picker).toBeFocused();
        await picker.getByRole('tab', { name: ar ? 'صفحة' : 'Page' }).click();
        await picker.getByRole('button', { name: ar ? /سياسة الخصوصية/ : /Privacy policy/ }).click();
        await editor.getByRole('button', { name: ar ? 'إضافة رابط' : 'Add link' }).click();
        await page.locator('[data-nav-picker]').getByRole('tab', { name: ar ? 'تصنيف' : 'Category' }).click();
        await page.locator('[data-nav-picker]').getByRole('option').first().click();
        await expect(editor.locator('[data-footer-link-row]')).toHaveCount(2);

        // the Canvas shows the group and its two links, in place of the fixed columns
        const footer = page.locator('[data-preview-canvas] footer');
        await expect(footer.locator('h2', { hasText: ar ? 'معلومات' : 'Info' })).toBeVisible();
        await expect(footer.locator('[data-footer-group] li')).toHaveCount(2);

        // a designed (dark brand-green) background through the colour field: the Canvas takes it
        const bg = editor.locator('[data-colour-field="footer-bg"]');
        await bg.locator('input[type="text"], input:not([type])').first().fill('#12372a');
        await bg.locator('input[type="text"], input:not([type])').first().blur();
        await expect.poll(() => footer.evaluate((f) => (f as HTMLElement).style.getPropertyValue('--store-footer'))).toBe('#12372a');

        await assertNoOverflow(page);
        const inside = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll('[data-footer-editor] button, [data-footer-editor] input, [data-footer-editor] select')].every((el) => {
            const r = el.getBoundingClientRect();
            return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5);
          });
        });
        expect(inside).toBe(true);
        await page.screenshot({ path: path.join(evidenceDir, `footer-editor-${locale}-${width}.png`) });
      });
    }
  }
});
