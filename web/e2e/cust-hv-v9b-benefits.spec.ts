import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V9b — benefits icons and layout in the real builder (demo mode): add Benefits from the Library, write three benefits,
 * give two of them an icon, then walk the Design tab's layout (Automatic → Flat → 2 / 3 / 4 columns). The Canvas follows every edit:
 * the icon appears only on the items that have one, the card frame disappears for Flat, and the number of columns equals what the
 * storefront resolves for the SIMULATED device (phone 1, tablet 2, desktop = the layout's count). Nothing overflows. AR RTL + EN LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v9b');
const WIDTHS = [390, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;
const T = { ar: { design: 'التصميم', add: 'إضافة ميزة' }, en: { design: 'Design', add: 'Add benefit' } } as const;

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

const columns = (page: Page) =>
  page.evaluate(() => {
    const ul = document.querySelector('[data-preview-canvas] [data-benefits] > ul') as HTMLElement | null;
    return ul ? getComputedStyle(ul).gridTemplateColumns.split(' ').length : 0;
  });

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`benefits icons + layout ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
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
      await page.locator('[data-picker-option="benefits"]:visible').first().click();

      for (let i = 0; i < 3; i += 1) {
        await page.getByRole('button', { name: new RegExp(t.add) }).last().click();
      }
      const rows = page.locator('[data-benefit-row]:visible');
      await expect(rows).toHaveCount(3);
      for (let i = 0; i < 3; i += 1) {
        await rows.nth(i).locator('input').first().fill(`Benefit ${i + 1} ${'long-word'.repeat(6)}`);
      }
      await rows.nth(0).locator('[data-benefit-icon-select]').selectOption('truck');
      await rows.nth(1).locator('[data-benefit-icon-select]').selectOption('shield-check');

      const canvas = page.locator('[data-preview-canvas] [data-benefits]');
      await expect(canvas.locator('[data-benefit-item]')).toHaveCount(3);
      await expect(canvas.locator('[data-benefit-icon]')).toHaveCount(2);
      await expect(canvas.locator('[data-benefit-item]').nth(2).locator('[data-benefit-icon]')).toHaveCount(0);

      // the Design tab's layout: Automatic first
      await page.locator('[data-selected-section-settings]:visible').getByRole('button', { name: t.design, exact: true }).click();
      const layout = page.locator('[data-design-layout]:visible');
      await expect(layout).toBeVisible();

      // the builder decides which device it simulates for this window (phones: mobile); the columns follow THAT device
      const simulated = (await canvas.getAttribute('data-vp')) as 'desktop' | 'tablet' | 'mobile';
      expect(['desktop', 'tablet', 'mobile']).toContain(simulated);
      if (width < 768) expect(simulated).toBe('mobile');
      const expected = (n: number) => (simulated === 'desktop' ? n : simulated === 'tablet' ? 2 : 1);

      const walk: Array<[string, number]> = [['', 3], ['columns-2', 2], ['columns-3', 3], ['columns-4', 4], ['flat', 3]];
      for (const [value, wide] of walk) {
        await layout.selectOption(value);
        await expect(canvas).toHaveAttribute('data-benefits', value || 'auto');
        expect(await columns(page)).toBe(expected(wide));
        const framed = await canvas.locator('[data-benefit-item]').first().evaluate((el) => getComputedStyle(el).borderTopWidth !== '0px');
        expect(framed).toBe(value !== 'flat');
        // an unbroken word wraps inside its item
        const wraps = await canvas.locator('[data-benefit-item]').evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1));
        expect(wraps).toBe(true);
        expect(await overflow(page)).toBeLessThanOrEqual(baseline + 1);
      }

      // RTL / LTR: the icon sits on the inline-start edge of its item
      await layout.selectOption('columns-3');
      const first = canvas.locator('[data-benefit-item]').first();
      const edge = await first.evaluate((el) => {
        const item = el.getBoundingClientRect();
        const icon = el.querySelector('[data-benefit-icon]')!.getBoundingClientRect();
        const text = el.querySelector('p')!.getBoundingClientRect();
        const rtl = getComputedStyle(el).direction === 'rtl';
        return rtl ? { iconAtStart: icon.right > text.right && item.right - icon.right < 40 } : { iconAtStart: icon.left < text.left && icon.left - item.left < 40 };
      });
      expect(edge.iconAtStart).toBe(true);

      await page.screenshot({ path: path.join(evidenceDir, `benefits-${locale}-${width}.png`) });
    });
  }
}
