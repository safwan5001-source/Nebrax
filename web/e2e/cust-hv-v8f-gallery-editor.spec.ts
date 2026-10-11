import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V8f — the gallery editor in the real builder (demo mode): add a Gallery from the Library, add three pictures through the picker,
 * write a caption, set columns / shape / captions, choose the strip layout in the Design tab — and watch the Canvas follow each edit
 * (picture count, order, the captions switch, the column count of the SIMULATED device, the strip layout, the ringed selection).
 * Nothing overflows and every control stays inside the viewport. AR RTL + EN LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v8f');
const WIDTHS = [390, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

const T = {
  ar: { design: 'التصميم', caption: 'تشكيلة الربيع', captions: 'إظهار التعليقات تحت الصور', columns4: '4' },
  en: { design: 'Design', caption: 'Spring collection', captions: 'Show captions under the pictures', columns4: '4' },
} as const;

const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${fill}"/></svg>`;

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function openHomepagePanel(page: Page, width: number) {
  if (width >= 1024) {
    await page.locator('[data-panel-option="homepage"]').first().click();
  } else if (width < 768) {
    await page.locator('[data-builder-mobile-bar] button').nth(2).click();
    await page.locator('[data-design-panel-select]').selectOption('homepage');
  } else {
    await page.locator('[data-builder-edit-toggle]').click();
    await page.locator('[data-builder-controls] #customizer-panel-select').selectOption('homepage');
  }
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`gallery editor ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.route('https://signed.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg('#22303d') }));
      await page.setViewportSize({ width, height: 960 });
      await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-experience-builder]');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForTimeout(300);
      const baseline = await overflow(page);
      const t = T[locale];

      await openHomepagePanel(page, width);
      await page.locator('[data-add-section]:visible').first().click();
      const option = page.locator('[data-picker-option="gallery"]:visible').first();
      await expect(option).toBeEnabled();
      await option.click();

      const fields = page.locator('[data-gallery-fields]:visible');
      await expect(fields).toBeVisible();
      await expect(fields.locator('[data-gallery-min]')).toBeVisible();

      // three pictures through the picker (demo library)
      for (let i = 0; i < 3; i += 1) {
        await fields.locator('[data-gallery-add]').click();
        const picker = page.locator('[data-media-picker]');
        await expect(picker).toBeVisible();
        await picker.locator('[data-media-state="ready"]').first().getByRole('button').click();
        await expect(picker).toBeHidden();
        await expect(fields.locator('[data-gallery-image-row]')).toHaveCount(i + 1);
      }
      await expect(fields.locator('[data-gallery-min]')).toHaveCount(0);

      // the Canvas follows: one gallery with three pictures, a grid by default
      const canvas = page.locator('[data-preview-canvas] [data-gallery]');
      await expect(canvas).toHaveCount(1);
      await expect(canvas.locator('[data-gallery-item]')).toHaveCount(3);
      await expect(canvas).toHaveAttribute('data-layout', 'grid');
      // the last-added picture is selected and ringed
      const ids = await fields.locator('[data-gallery-image-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-gallery-image-row')));
      await expect(canvas.locator('[data-gallery-item][data-selected]')).toHaveAttribute('data-image-id', ids[2] ?? '');

      // a caption reaches the Canvas only when captions are on
      await fields.locator('[data-gallery-caption-input]').fill(t.caption);
      await expect(canvas.locator('figcaption')).toHaveCount(0);
      await fields.getByLabel(t.captions).check({ force: true });
      await expect(canvas.locator('figcaption')).toHaveText(t.caption);

      // selecting another row moves the ring
      await fields.locator('[data-gallery-image-row]').first().locator('button').first().click();
      await expect(canvas.locator('[data-gallery-item][data-selected]')).toHaveAttribute('data-image-id', ids[0] ?? '');

      // options: columns and shape reach the Canvas attributes; the visible column count is the simulated device's
      await fields.locator('[data-gallery-options]').getByRole('button', { name: t.columns4, exact: true }).click();
      await fields.locator('[data-gallery-options]').getByRole('button', { name: '16:9', exact: true }).click();
      await expect(canvas).toHaveAttribute('data-cols', '4');
      await expect(canvas).toHaveAttribute('data-aspect', '16-9');

      // reorder: the third picture moves up, the Canvas order follows
      await fields.locator('[data-gallery-image-row]').nth(2).locator('button[aria-label]').first().click();
      const after = await fields.locator('[data-gallery-image-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-gallery-image-row')));
      expect(after).toEqual([ids[0], ids[2], ids[1]]);
      await expect(canvas.locator('[data-gallery-item]').nth(1)).toHaveAttribute('data-image-id', ids[2] ?? '');

      // duplicate, then delete the copy
      await fields.locator('[data-gallery-image-row]').first().locator('button[aria-label]').nth(2).click();
      await expect(fields.locator('[data-gallery-image-row]')).toHaveCount(4);
      await fields.locator('[data-gallery-image-row]').nth(1).locator('button[aria-label]').nth(3).click();
      await expect(fields.locator('[data-gallery-image-row]')).toHaveCount(3);

      // the strip layout is the section design's: choose it in the Design tab, the Canvas turns into a strip
      await page.locator('[data-selected-section-settings]:visible').getByRole('button', { name: t.design, exact: true }).click();
      const layout = page.locator('[data-design-layout]:visible');
      await expect(layout).toBeVisible();
      await expect(layout.locator('option').first()).toHaveText(locale === 'ar' ? 'شبكة' : 'Grid');
      await layout.selectOption('carousel');
      await expect(canvas).toHaveAttribute('data-layout', 'carousel');

      expect(await overflow(page)).toBeLessThanOrEqual(baseline + 1);
      const inside = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('[data-gallery-fields] button, [data-gallery-fields] input, [data-design-inspector] select')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .every((el) => {
            const r = el.getBoundingClientRect();
            return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5);
          });
      });
      expect(inside).toBe(true);
      await page.screenshot({ path: path.join(evidenceDir, `gallery-editor-${locale}-${width}.png`) });
    });
  }
}
