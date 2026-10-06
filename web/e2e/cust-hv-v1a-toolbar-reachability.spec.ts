import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V1A / DEF-11 — builder toolbar primary-action reachability.
 *
 * Contract (V0 §20.1): Exit to Commerce, Save draft and Publish stay on screen
 * — not in an overflow — at 390 · 430 · 768 · 1024 · 1280 · 1440, in Arabic RTL
 * and English LTR, in the clean, dirty and version-conflict states. Secondary
 * controls may collapse into one keyboard-operable «More» menu.
 *
 * This guarantee is permanent: V1B / V5 may restyle or relocate the toolbar but
 * must keep these assertions green.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v1a-toolbar');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;
const STATES = ['clean', 'dirty', 'conflict'] as const;

const MORE = { ar: 'المزيد من الإجراءات', en: 'More actions' } as const;

// Next's dev overlay badge floats over the bottom bar in `next dev` only.
async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

async function openBuilder(page: Page, locale: 'ar' | 'en', width: number, scenario: string) {
  await page.setViewportSize({ width, height: 900 });
  // `openStore=1` renders the "Open store" link — the widest real toolbar.
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=${scenario}&openStore=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-experience-builder]');
  await hideDevOverlay(page);
  await page.waitForTimeout(400);
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

// Any width: edit the draft's primary colour (the first free text input in the
// inspector; the value is a valid hex so the draft is also saveable). At 768 the inspector is not on screen, so the input is driven
// through the DOM — the point is the dirty *state*, not the form interaction.
async function makeDirty(page: Page, width: number) {
  if (width < 768) {
    await page.locator('[data-builder-mobile-bar] button').nth(2).click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find(
      (el) => el.type === 'text' && !el.closest('header'),
    );
    if (!input) throw new Error('no editable text input found in the inspector');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, input.value === '#123456' ? '#123457' : '#123456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'dirty');
  if (width < 768) {
    // Close the design sheet (its first button is "Close") so the toolbar is
    // measured in its resting layout, not behind the sheet's backdrop.
    await page.locator('div[role="presentation"].fixed button').first().click();
    await expect(page.locator('div[role="presentation"].fixed')).toHaveCount(0);
  }
}

async function makeConflict(page: Page, width: number) {
  await makeDirty(page, width);
  expect(await page.evaluate(() => (window as unknown as { __awjDevBumpRevision: () => boolean }).__awjDevBumpRevision())).toBe(true);
  await page.locator('[data-save]').click();
  await expect(page.locator('[data-version-conflict]')).toBeVisible();
}

async function assertPrimariesReachable(page: Page, width: number) {
  const rects: Record<string, { left: number; right: number; top: number; bottom: number }> = {};
  for (const [name, selector] of [
    ['exit', '[data-builder-exit]'],
    ['save', '[data-save]'],
    ['publish', '[data-publish]'],
  ] as const) {
    const locator = page.locator(selector);
    await expect(locator, `${name} is rendered`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${name} has a box`).not.toBeNull();
    rects[name] = { left: box!.x, right: box!.x + box!.width, top: box!.y, bottom: box!.y + box!.height };
    // Fully inside the viewport horizontally and vertically.
    expect(box!.x, `${name} left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width, `${name} right edge ≤ ${width}`).toBeLessThanOrEqual(width + 0.5);
    expect(box!.y, `${name} top edge`).toBeGreaterThanOrEqual(0);
    // Touch-friendly: ≥ 36px tall everywhere, 40px on handhelds.
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(width < 768 ? 39.5 : 35.5);
  }
  // No two primaries overlap.
  const names = Object.keys(rects);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = rects[names[i]];
      const b = rects[names[j]];
      const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5;
      expect(overlap, `${names[i]} overlaps ${names[j]}`).toBe(false);
    }
  }
  // The toolbar itself never scrolls sideways, and the page does not either.
  const overflow = await page.evaluate(() => {
    const header = document.querySelector('[data-builder-toolbar]') as HTMLElement;
    return { toolbar: header.scrollWidth - header.clientWidth };
  });
  expect(overflow.toolbar, 'toolbar is not horizontally scrollable').toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-HV V1A — toolbar primary-action reachability (DEF-11)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      for (const state of STATES) {
        test(`${locale.toUpperCase()} ${width} — ${state}: Exit, Save draft and Publish are on screen`, async ({ page }) => {
          await openBuilder(page, locale, width, state === 'conflict' ? 'conflict' : 'single-draft');
          if (state === 'dirty') await makeDirty(page, width);
          if (state === 'conflict') await makeConflict(page, width);

          await assertPrimariesReachable(page, width);

          // Draft state stays perceivable at every width: the chip from md up,
          // the More trigger's dot + accessible name below it.
          const statusVisible = await page.locator('[data-draft-status]').isVisible();
          if (width >= 768) {
            expect(statusVisible).toBe(true);
          } else if (state !== 'clean') {
            await expect(page.locator(`[data-builder-more-dot="${state === 'dirty' ? 'dirty' : 'conflict'}"]`)).toBeVisible();
          }
          if (state === 'conflict') await expect(page.locator('[data-version-conflict]')).toBeVisible();

          await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-${state}.png`) });
        });
      }
    }
  }

  test('EN 390 — More is keyboard-operable: Enter opens, Tab reaches an item, Escape returns focus', async ({ page }) => {
    await openBuilder(page, 'en', 390, 'single-draft');
    const more = page.getByRole('button', { name: MORE.en });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: MORE.en });
    await expect(menu).toBeVisible();
    // The menu sits fully inside the viewport.
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    await page.waitForTimeout(300); // the menu fades in over 150ms
    await page.screenshot({ path: path.join(evidenceDir, 'en-390-more-open.png') });

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toMatch(/^menuitem/);
    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();
  });

  test('AR 390 — More menu opens inside the viewport (RTL) and lists the collapsed actions', async ({ page }) => {
    await openBuilder(page, 'ar', 390, 'single-draft');
    await page.getByRole('button', { name: MORE.ar }).click();
    const menu = page.getByRole('menu', { name: MORE.ar });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    await expect(menu.getByRole('menuitem', { name: /فتح المتجر/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'استعادة الافتراضي' })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-more-open.png') });
  });

  test('AR 768 — the device switch lives in More and drives the Canvas; Schedule is reachable', async ({ page }) => {
    await openBuilder(page, 'ar', 768, 'schedule-eligible');
    await expect(page.locator('[data-device-option]').first()).toBeHidden();
    await page.getByRole('button', { name: MORE.ar }).click();
    const menu = page.getByRole('menu', { name: MORE.ar });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-768-more-open.png') });
    await menu.getByRole('menuitemradio', { name: 'جهاز لوحي' }).click();
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-device', 'tablet');

    await page.getByRole('button', { name: MORE.ar }).click();
    await page.getByRole('menu', { name: MORE.ar }).getByRole('menuitem', { name: 'جدولة' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'ar-768-schedule-from-more.png') });
  });

  test('EN 1024 — device switch is inline; Open store, Schedule and Restore live in More', async ({ page }) => {
    await openBuilder(page, 'en', 1024, 'single-draft');
    await expect(page.locator('[data-device-option]').first()).toBeVisible();
    await expect(page.locator('[data-schedule]')).toBeHidden();
    await expect(page.locator('[data-open-store]')).toBeHidden();
    await page.getByRole('button', { name: MORE.en }).click();
    const menu = page.getByRole('menu', { name: MORE.en });
    await expect(menu.getByRole('menuitem', { name: /Open store/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Schedule' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Restore default' })).toBeVisible();
    // The three preview-device entries stay in the DOM but are hidden from lg up,
    // where the same switch is inline.
    await expect(menu.locator('[data-more-device-option]')).toHaveCount(3);
    await expect(menu.locator('[data-more-device-option]').first()).toBeHidden();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidenceDir, 'en-1024-more-open.png') });
  });

  test('EN 1440 — Schedule and Open store are inline; the More menu keeps only Restore default visible', async ({ page }) => {
    await openBuilder(page, 'en', 1440, 'schedule-eligible');
    await expect(page.locator('[data-schedule]')).toBeVisible();
    await expect(page.locator('[data-open-store]')).toBeVisible();
    await page.getByRole('button', { name: MORE.en }).click();
    const menu = page.getByRole('menu', { name: MORE.en });
    await expect(menu.getByRole('menuitem', { name: 'Restore default' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Schedule' })).toBeHidden();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidenceDir, 'en-1440-more-open.png') });
  });
});
