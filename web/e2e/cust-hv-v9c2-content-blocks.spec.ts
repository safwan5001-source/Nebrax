import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V9c-2 — the Custom Content block editor in the real builder (demo mode): add Custom Content from the Library, then a heading (level 3,
 * centred), a paragraph with a line break, a picture through the picker, a button, a callout (success, with an icon) and a two-column block with
 * blocks inside both columns — and watch the Canvas follow each edit (what is drawn, heading level and logical alignment, the ringed selection,
 * the columns of the SIMULATED device). Reorder / duplicate / delete follow too. Nothing overflows and every control stays inside the viewport.
 * AR RTL + EN LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v9c2');
const WIDTHS = [390, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

const T = {
  ar: { heading: 'عنوان', paragraph: 'فقرة', button: 'زر', callout: 'تنبيه', columns: 'عمودان', level3: 'فرعي', center: 'الوسط', success: 'نجاح', moveUp: /نقل الكتلة .* إلى الأعلى/, dup: /تكرار الكتلة/, del: /حذف الكتلة/ },
  en: { heading: 'Heading', paragraph: 'Paragraph', button: 'Button', callout: 'Callout', columns: 'Two columns', level3: 'Sub-heading', center: 'Centre', success: 'Success', moveUp: /Move block .* up/, dup: /Duplicate block/, del: /Delete block/ },
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
    test(`content blocks ${locale} @ ${width}`, async ({ page }) => {
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
      const option = page.locator('[data-picker-option="customContent"]:visible').first();
      await expect(option).toBeEnabled();
      await option.click();

      const fields = page.locator('[data-content-blocks-fields]:visible');
      await expect(fields).toBeVisible();
      await expect(fields.locator('[data-content-blocks-empty]')).toBeVisible();
      const addTop = fields.locator('[data-content-add-block="top"]');
      const canvas = page.locator('[data-preview-canvas] [data-content-blocks]');

      // heading: level 3, centred
      await addTop.selectOption('heading');
      const editor = () => fields.locator('[data-content-block-editor]');
      await editor().locator('[data-content-text]').fill('Why customers love us');
      await editor().getByRole('button', { name: t.level3, exact: true }).click();
      await editor().getByRole('button', { name: t.center, exact: true }).click();
      // a text-only section keeps its original preview: the heading is an h3, centred
      await expect(page.locator('[data-preview-canvas] h3', { hasText: 'Why customers love us' })).toHaveCSS('text-align', 'center');

      // paragraph with a line break (spaces survive typing)
      await addTop.selectOption('paragraph');
      await editor().locator('[data-content-text]').fill('Fresh flowers, same day.\nWrapped by hand.');
      await expect(page.locator('[data-preview-canvas] p', { hasText: 'Wrapped by hand.' })).toHaveCSS('white-space', 'pre-line');

      // a picture through the picker: from here on the section uses the general path
      await addTop.selectOption('image');
      const picker = page.locator('[data-media-picker]');
      await expect(picker).toBeVisible();
      await picker.locator('[data-media-state="ready"]').first().getByRole('button').click();
      await expect(picker).toBeHidden();
      await expect(canvas).toHaveCount(1);
      await expect(canvas.locator('[data-content-image] img')).toHaveCount(1);
      await editor().locator('[data-content-caption]').fill('Spring collection');
      await expect(canvas.locator('figcaption')).toHaveText('Spring collection');

      // a button: not drawn until it has a link
      await addTop.selectOption('button');
      await expect(fields.locator('[data-content-button-incomplete]')).toBeVisible();
      await expect(canvas.locator('[data-content-button]')).toHaveCount(0);
      const link = editor().getByLabel(/\/products/);
      await link.fill('/products');
      await link.blur();
      await expect(canvas.locator('[data-content-button]')).toHaveCount(1);
      await expect(fields.locator('[data-content-button-incomplete]')).toHaveCount(0);

      // a success callout with an icon
      await addTop.selectOption('callout');
      await editor().locator('[data-content-text]').fill('Free delivery over 200');
      await editor().getByRole('button', { name: t.success, exact: true }).click();
      await editor().locator('[data-content-callout-icon]').selectOption('gift');
      await expect(canvas.locator('[data-content-callout="success"] svg')).toHaveCount(1);

      // two columns, a block in each
      await addTop.selectOption('columns');
      const columnsId = await fields.locator('[data-content-columns-editor]').getAttribute('data-content-columns-editor');
      await fields.locator(`[data-content-add-block="${columnsId}:0"]`).selectOption('paragraph');
      await editor().locator('[data-content-text]').fill('Left column');
      await fields.locator(`[data-content-add-block="${columnsId}:1"]`).selectOption('paragraph');
      await editor().locator('[data-content-text]').fill('Right column');
      await expect(canvas.locator('[data-content-column]')).toHaveCount(2);

      // the columns follow the SIMULATED device: one on phones, two otherwise
      const simulated = (await canvas.getAttribute('data-vp')) as 'desktop' | 'tablet' | 'mobile';
      if (width < 768) expect(simulated).toBe('mobile');
      const cols = await page.evaluate(() => {
        const el = document.querySelector('[data-preview-canvas] [data-content-columns]') as HTMLElement;
        return getComputedStyle(el).gridTemplateColumns.split(' ').length;
      });
      expect(cols).toBe(simulated === 'mobile' ? 1 : 2);

      // reading order: the first column is on the inline-start side in both directions
      const order = await page.evaluate(() => {
        const [a, b] = [...document.querySelectorAll('[data-preview-canvas] [data-content-column]')].map((e) => e.getBoundingClientRect());
        const rtl = getComputedStyle(document.querySelector('[data-preview-canvas] [data-content-blocks]')!).direction === 'rtl';
        return { stacked: b.top >= a.bottom - 1, firstOnStart: rtl ? a.left > b.left : a.left < b.left };
      });
      if (simulated === 'mobile') expect(order.stacked).toBe(true);
      else expect(order.firstOnStart).toBe(true);

      // the selection is ringed (the last block added, inside the second column)
      await expect(canvas.locator('[data-content-block][data-selected]')).toHaveCount(1);
      await expect(canvas.locator('[data-content-block][data-selected]')).toContainText('Right column');

      // reorder / duplicate / delete
      const rows = fields.locator('[data-content-block-list] > li > [data-content-block-row]');
      expect(await rows.count()).toBe(6);
      await rows.nth(1).getByRole('button', { name: t.moveUp }).click();
      await expect(rows.nth(0)).toHaveAttribute('data-kind', 'paragraph');
      await rows.nth(0).getByRole('button', { name: t.dup }).click();
      await expect(rows).toHaveCount(7);
      await rows.nth(1).getByRole('button', { name: t.del }).click();
      await expect(rows).toHaveCount(6);

      expect(await overflow(page)).toBeLessThanOrEqual(baseline + 1);
      const inside = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('[data-content-blocks-fields] button, [data-content-blocks-fields] input, [data-content-blocks-fields] select, [data-content-blocks-fields] textarea')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .every((el) => {
            const r = el.getBoundingClientRect();
            return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5);
          });
      });
      expect(inside).toBe(true);
      await page.screenshot({ path: path.join(evidenceDir, `content-blocks-${locale}-${width}.png`) });
    });
  }
}
