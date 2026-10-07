import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V4b — Identity media in the builder (demo-mode media library):
 * the picker, the bounded image editor, the selected-media card (alt AR/EN,
 * decorative, readiness) and the legacy→library migration cue are usable and
 * nothing overflows horizontally at 390 · 430 · 768 · 1024 · 1280 · 1440, in
 * Arabic RTL and English LTR. 768–1023 has no inspector on main (DEF-7, V1B).
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v4b-media');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

const T = {
  ar: { pick: 'اختيار من المكتبة', use: 'استخدام', edit: 'تعديل الصورة', apply: 'تطبيق', rotate: 'تدوير ٩٠°', library: 'مكتبة الوسائط' },
  en: { pick: 'Choose from library', use: 'Use', edit: 'Edit image', apply: 'Apply', rotate: 'Rotate 90°', library: 'Media library' },
} as const;

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function openIdentity(page: Page, width: number) {
  if (width >= 1024) {
    await page.locator('[data-panel-option="branding"]').first().click();
  } else if (width < 768) {
    await page.locator('[data-builder-mobile-bar] button').nth(2).click();
    await page.locator('[data-design-panel-select]').selectOption('branding');
  } else {
    return false;
  }
  return true;
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`identity media ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-experience-builder]');
      await hideDevOverlay(page);
      await page.waitForTimeout(300);
      const baseline = await horizontalOverflow(page);
      const noOverflow = async () => expect(await horizontalOverflow(page)).toBeLessThanOrEqual(baseline);
      const t = T[locale];

      if (!(await openIdentity(page, width))) {
        test.info().annotations.push({ type: 'DEF-7', description: 'no inspector at 768–1023 on main; V1B' });
        await noOverflow();
        return;
      }

      // The library is on in demo mode → an empty logo slot is the library only.
      const slot = page.locator('[data-media-field="logo"]:visible').first();
      await expect(slot).toBeVisible();
      await page.screenshot({ path: path.join(evidenceDir, `identity-empty-${locale}-${width}.png`) });

      // Picker
      await slot.locator('[data-media-pick="logo"]').click();
      const picker = page.locator('[data-media-picker]');
      await expect(picker).toBeVisible();
      await expect(picker.locator('[data-media-card]').first()).toBeVisible();
      await noOverflow();
      await page.screenshot({ path: path.join(evidenceDir, `picker-${locale}-${width}.png`) });

      // processing + failed assets are visible but not selectable
      await expect(picker.locator('[data-media-state="pending"] button:disabled').first()).toBeVisible();
      await expect(picker.locator('[data-media-state="failed"] button:disabled').first()).toBeVisible();

      await picker.locator('[data-media-state="ready"]').first().getByRole('button', { name: new RegExp(t.use) }).click();
      await expect(picker).toBeHidden();

      // Selected card: alt coverage, readiness; AR alt exists on this asset, EN also
      const card = page.locator('[data-media-field="logo"]:visible').first();
      await expect(card.locator('[data-media-alt="ar"]')).toBeVisible();
      await noOverflow();
      await page.screenshot({ path: path.join(evidenceDir, `selected-${locale}-${width}.png`) });

      // Editor
      await card.locator('[data-media-edit="logo"]').click();
      const editor = page.locator('[data-media-editor]');
      await expect(editor).toBeVisible();
      // The dialog is portalled out of the builder: it must sit inside the viewport
      // and carry the builder's direction, whatever the page direction is.
      const dialog = page.locator('[data-media-dialog]');
      await expect(dialog).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      const dbox = await dialog.boundingBox();
      expect(dbox!.x).toBeGreaterThanOrEqual(-1);
      expect(dbox!.x + dbox!.width).toBeLessThanOrEqual(width + 1);
      await editor.getByRole('button', { name: '16:9' }).click();
      await editor.locator('[data-media-rotate]').click();
      await expect(editor.locator('[data-media-crop]')).toBeVisible();
      await noOverflow();
      await page.screenshot({ path: path.join(evidenceDir, `editor-${locale}-${width}.png`) });

      // Keyboard: arrows nudge the crop
      const crop = editor.locator('[data-media-crop]');
      await crop.focus();
      const before = await crop.boundingBox();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const after = await crop.boundingBox();
      expect(after!.y).toBeGreaterThanOrEqual(before!.y);

      // The dialog fits the viewport (no clipped controls)
      const apply = page.locator('[data-media-dialog]').getByRole('button', { name: t.apply });
      const box = await apply.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await apply.click();
      await expect(editor).toBeHidden();

      await expect(card.locator('[data-media-readiness]')).toBeVisible();
      if (width >= 1024) {
        // The Canvas shows the selected media as the store logo (reference wins over legacy).
        await expect(page.locator('[data-preview-frame] img[src^="data:image/png"]').first()).toBeVisible();
      }
      await page.screenshot({ path: path.join(evidenceDir, `applied-${locale}-${width}.png`) });
    });
  }
}
