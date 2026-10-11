import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V8c-2 — the slider editor in the real builder (demo mode): add a Slider from the Library, add three slides through the
 * picker, write copy and a button, reorder / duplicate / delete, set behaviour — and watch the Canvas follow every edit (slide count,
 * order, copy, the selected slide on show; browsing in the Canvas selects the slide in the panel). Nothing overflows and every control
 * stays inside the viewport. AR RTL + EN LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v8c2');
const WIDTHS = [390, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

const T = {
  ar: { add: 'إضافة شريحة', heading: 'العنوان', ctaLabel: 'نص الزر', slides: 'الشرائح', autoplay: 'تشغيل تلقائي', none: 'بلا حركة', dots: 'نقاط التنقل' },
  en: { add: 'Add a slide', heading: 'Heading', ctaLabel: 'Button label', slides: 'Slides', autoplay: 'Autoplay', none: 'None', dots: 'Navigation dots' },
} as const;

const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${fill}"/></svg>`;

async function mockEvidence(page: Page) {
  // every picture is dark with proven bounds, so copy over it is provable and the Canvas draws the picture
  await page.route('https://signed.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg('#22303d') }));
  await page.route('**/commerce/workspace/storefront-media/*/derivatives/status', (route) => {
    const id = route.request().url().match(/storefront-media\/([^/]+)\/derivatives/)?.[1] ?? 'x';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            media_id: id,
            usage_key: 'u',
            state: 'ready',
            files: [{ width: 1600, format: 'jpg', state: 'ready', url: 'https://signed.example/dark.svg', rendered_width: 1600, rendered_height: 900 }],
            contrast: { min: [30, 40, 55], max: [50, 62, 80] },
          },
        ],
      }),
    });
  });
}

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
    test(`slider editor ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await mockEvidence(page);
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
      const option = page.locator('[data-picker-option="slider"]:visible').first();
      await expect(option).toBeEnabled();
      await option.click();

      const fields = page.locator('[data-slider-fields]:visible');
      await expect(fields).toBeVisible();
      await expect(fields.locator('[data-slider-min]')).toBeVisible();

      // three slides through the picker (demo library)
      for (let i = 0; i < 3; i += 1) {
        await fields.locator('[data-slider-add]').click();
        const picker = page.locator('[data-media-picker]');
        await expect(picker).toBeVisible();
        await picker.locator('[data-media-state="ready"]').first().getByRole('button').click();
        await expect(picker).toBeHidden();
        await expect(fields.locator('[data-slider-slide-row]')).toHaveCount(i + 1);
      }
      await expect(fields.locator('[data-slider-min]')).toHaveCount(0);
      await expect(fields.locator('[data-slider-count]')).toHaveText(/3/);

      // the Canvas follows: a carousel with three slides
      const canvas = page.locator('[data-preview-canvas] [data-slider]');
      await expect(canvas).toHaveCount(1);
      await expect(canvas.locator('[data-slider-slide]')).toHaveCount(3);

      // copy on the (selected = last added) slide reaches the Canvas, the button needs label + link
      await fields.locator('[data-slider-heading]').fill(locale === 'ar' ? 'تشكيلة الصيف' : 'Summer collection');
      await expect(canvas.locator('[data-slider-slide][data-active] h2')).toHaveText(locale === 'ar' ? 'تشكيلة الصيف' : 'Summer collection');
      await fields.getByLabel(t.ctaLabel).fill(locale === 'ar' ? 'تسوّق' : 'Shop');
      await expect(canvas.locator('[data-slider-slide][data-active] [data-slider-cta]')).toHaveCount(0);

      // the selected slide is the one on show: choose slide 1 in the list, the Canvas goes there
      await fields.locator('[data-slider-slide-row]').first().locator('button').first().click();
      await expect(canvas.locator('[data-slider-slide][data-active]')).toHaveAttribute('data-slide-id', (await fields.locator('[data-slider-slide-row]').first().getAttribute('data-slider-slide-row')) ?? '');

      // browsing in the Canvas selects in the panel
      // (below 768 the panel is a bottom sheet over the Canvas, so the click is dispatched to the element rather than aimed at pixels)
      const dot = canvas.locator('[data-slider-dots] button').nth(2);
      if (width < 768) await dot.dispatchEvent('click');
      else await dot.click();
      await expect(fields.locator('[data-slider-slide-row]').nth(2)).toHaveAttribute('data-selected', '');

      // reorder: the third slide moves up, the Canvas order follows
      const idsBefore = await fields.locator('[data-slider-slide-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-slider-slide-row')));
      await fields.locator('[data-slider-slide-row]').nth(2).locator('button[aria-label]').first().click();
      const idsAfter = await fields.locator('[data-slider-slide-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-slider-slide-row')));
      expect(idsAfter).toEqual([idsBefore[0], idsBefore[2], idsBefore[1]]);
      await expect(canvas.locator('[data-slider-slide]').nth(1)).toHaveAttribute('data-slide-id', idsBefore[2] ?? '');

      // duplicate then delete
      await fields.locator('[data-slider-slide-row]').first().locator('button[aria-label]').nth(2).click();
      await expect(fields.locator('[data-slider-slide-row]')).toHaveCount(4);
      await fields.locator('[data-slider-slide-row]').nth(1).locator('button[aria-label]').nth(3).click();
      await expect(fields.locator('[data-slider-slide-row]')).toHaveCount(3);

      // behaviour: dots off ⇒ no dots in the Canvas; transition none hides the speed control
      await fields.getByLabel(t.dots).uncheck({ force: true });
      await expect(canvas.locator('[data-slider-dots]')).toHaveCount(0);
      await fields.locator('[data-slider-behaviour]').getByRole('button', { name: t.none, exact: true }).click();
      await expect(canvas).toHaveAttribute('data-transition', 'none');

      expect(await overflow(page)).toBeLessThanOrEqual(baseline + 1);
      const inside = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('[data-slider-fields] button, [data-slider-fields] input, [data-slider-fields] select, [data-slider-fields] textarea')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .every((el) => {
            const r = el.getBoundingClientRect();
            return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5);
          });
      });
      expect(inside).toBe(true);
      await page.screenshot({ path: path.join(evidenceDir, `slider-editor-${locale}-${width}.png`) });
    });
  }
}
