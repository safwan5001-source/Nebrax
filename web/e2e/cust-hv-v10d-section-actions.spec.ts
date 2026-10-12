import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V10d — the real builder (demo mode): the Canvas hover action bar appears on hover / selection, stays inside the Canvas, and its
 * buttons edit the draft; the section list reorders by drag and drop as well as by its buttons; the Library shows a wireframe per type.
 * AR RTL + EN LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v10d');
const LOCALES = ['ar', 'en'] as const;

async function open(page: Page, locale: string, width: number) {
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width, height: 960 });
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-experience-builder]');
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(300);
}

/** The demo draft starts empty: add sections through the real Library (which also exercises its thumbnails). */
async function addSections(page: Page, types: string[]) {
  await page.locator('[data-panel-option="homepage"]').first().click();
  for (const type of types) {
    await page.locator('[data-add-section]:visible').first().click();
    await page.locator(`[data-picker-option="${type}"]`).click();
  }
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

const order = (page: Page) =>
  page.locator('[data-preview-section-id]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-preview-section-id')));

for (const locale of LOCALES) {
  test(`hover action bar ${locale} @ 1280`, async ({ page }) => {
    await open(page, locale, 1280);
    await addSections(page, ['categories', 'newArrivals', 'benefits']);
    const sections = page.locator('[data-preview-section-id]');
    const first = sections.nth(1);
    const id = (await first.getAttribute('data-preview-section-id')) as string;
    const bar = page.locator(`[data-section-actions="${id}"]`);
    await expect(bar).toBeHidden();
    await first.hover();
    await expect(bar).toBeVisible();

    // inside the Canvas frame, on the inline-end edge
    const frame = (await page.locator('[data-preview-frame]').boundingBox())!;
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    const wrapper = (await first.boundingBox())!;
    if (locale === 'ar') expect(box.x - wrapper.x).toBeLessThan(wrapper.x + wrapper.width - (box.x + box.width) + 1);
    else expect(wrapper.x + wrapper.width - (box.x + box.width)).toBeLessThan(box.x - wrapper.x + 1);
    await page.screenshot({ path: path.join(evidenceDir, `bar-${locale}.png`) });

    const before = await order(page);
    await bar.locator('[data-section-action="down"]').click();
    const after = await order(page);
    expect(after).not.toEqual(before);
    expect(new Set(after)).toEqual(new Set(before));
    expect(await page.locator('[data-experience-builder]').getAttribute('data-lifecycle')).toBe('dirty');
  });

  test(`drag and drop reorders the section list ${locale} @ 1280`, async ({ page }) => {
    await open(page, locale, 1280);
    await addSections(page, ['categories', 'newArrivals', 'benefits']);
    const rows = page.locator('[data-composer-section]');
    const ids = await rows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-section-id')));
    expect(ids.length).toBeGreaterThan(2);
    await rows.nth(0).locator('[data-drag-handle]').dragTo(rows.nth(2));
    const next = await rows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-section-id')));
    expect(next).toEqual([ids[1], ids[2], ids[0], ...ids.slice(3)]);
    await page.screenshot({ path: path.join(evidenceDir, `list-${locale}.png`) });
  });

  for (const width of [390, 1024] as const) {
    test(`Library thumbnails ${locale} @ ${width}`, async ({ page }) => {
      await open(page, locale, width);
      const baseline = await overflow(page);
      if (width >= 1024) {
        await page.locator('[data-panel-option="homepage"]').first().click();
      } else {
        await page.locator('[data-builder-mobile-bar] button').nth(1).click();
      }
      await page.locator('[data-add-section]:visible').first().click();
      const thumbs = page.locator('[data-section-thumbnail]:visible');
      await expect(thumbs.first()).toBeVisible();
      expect(await thumbs.count()).toBeGreaterThanOrEqual(10);
      expect(await overflow(page)).toBeLessThanOrEqual(baseline);
      await page.screenshot({ path: path.join(evidenceDir, `library-${locale}-${width}.png`) });
    });
  }
}

// CUST-HV V10c + V10d — the name chip (inline-start) and the hover action bar (inline-end) share the selected section: never overlapping.
for (const locale of LOCALES) {
  for (const width of [1024, 1280] as const) {
    test(`name chip and action bar never overlap ${locale} @ ${width} (simulated phone)`, async ({ page }) => {
      await open(page, locale, width);
      await addSections(page, ['benefits']);
      // the narrowest Canvas: the builder simulating a phone, where a 60-character name is wider than the room beside the bar
      await page.locator('[data-device-option="mobile"]:visible').first().click();
      const field = page.locator('[data-section-name]:visible').first();
      await field.fill(`Eid perks ${'very-long-name '.repeat(8)}`);
      const section = page.locator('[data-preview-canvas] [data-preview-section="benefits"]').first();
      await section.hover();
      const bar = page.locator(`[data-section-actions="${await section.getAttribute('data-preview-section-id')}"]`);
      await expect(bar).toBeVisible();
      const chip = section.locator('[data-section-chip]');
      await expect(chip).toHaveCount(1);
      const [c, b] = [(await chip.boundingBox())!, (await bar.boundingBox())!];
      const apart = c.x + c.width <= b.x + 1 || b.x + b.width <= c.x + 1 || c.y + c.height <= b.y + 1 || b.y + b.height <= c.y + 1;
      expect(apart).toBe(true);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  }
}
