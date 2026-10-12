import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H5-2 — Undo / Redo in a real browser: reachability at 390 · 430 · 768 · 1024 · 1280 · 1440 in Arabic RTL and English LTR,
 * the primaries (Exit / Save / Publish) staying on screen with the two new controls present, keyboard shortcuts and focus.
 *
 * Inline Undo/Redo appear from md (768); below it the same two actions live in the «More» menu. The V1A guarantee for the
 * primaries is re-asserted here with the new controls in the bar.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h5-2-undo-redo');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;
const MORE = { ar: 'المزيد من الإجراءات', en: 'More actions' } as const;
const LABEL = { ar: { undo: 'تراجع عن التعديل', redo: 'إعادة التعديل' }, en: { undo: 'Undo', redo: 'Redo' } } as const;

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

async function openBuilder(page: Page, locale: 'ar' | 'en', width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft&openStore=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-experience-builder]');
  await hideDevOverlay(page);
  await page.waitForTimeout(400);
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

// Drives the first free text input through the DOM (the inspector is not on screen at 768) — the point is the history, not the form.
async function edit(page: Page, value: string) {
  await page.evaluate((next) => {
    const input = [...document.querySelectorAll('input')].find((el) => el.type === 'text' && !el.closest('header'));
    if (!input) throw new Error('no editable text input found');
    input.setAttribute('data-e2e-target', '');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

const lifecycle = (page: Page) => page.locator('[data-experience-builder]').getAttribute('data-lifecycle');

async function assertToolbarReachable(page: Page, width: number) {
  const rects: Record<string, { left: number; right: number }> = {};
  for (const [name, selector] of [
    ['exit', '[data-builder-exit]'],
    ['save', '[data-save]'],
    ['publish', '[data-publish]'],
  ] as const) {
    const box = await page.locator(selector).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.x, `${name} left`).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width, `${name} right ≤ ${width}`).toBeLessThanOrEqual(width + 0.5);
    rects[name] = { left: box!.x, right: box!.x + box!.width };
  }
  const names = Object.keys(rects);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = rects[names[i]];
      const b = rects[names[j]];
      expect(a.left < b.right - 0.5 && b.left < a.right - 0.5, `${names[i]} overlaps ${names[j]}`).toBe(false);
    }
  }
  const overflow = await page.evaluate(() => {
    const header = document.querySelector('[data-builder-toolbar]') as HTMLElement;
    return header.scrollWidth - header.clientWidth;
  });
  expect(overflow, 'toolbar is not horizontally scrollable').toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H5-2 — Undo / Redo', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      test(`${locale.toUpperCase()} ${width} — controls reachable, primaries intact, Undo/Redo round-trip`, async ({ page }) => {
        await openBuilder(page, locale, width);
        const inline = width >= 768;
        const undo = page.locator('[data-history-action="undo"]');
        const redo = page.locator('[data-history-action="redo"]');

        // Clean: nothing to undo.
        if (inline) {
          await expect(undo).toBeVisible();
          await expect(undo).toHaveAttribute('aria-disabled', 'true');
          await expect(redo).toHaveAttribute('aria-disabled', 'true');
        } else {
          await expect(undo).toBeHidden();
        }

        await edit(page, '#123456');
        await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'dirty');
        await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-can-undo', 'true');
        await assertToolbarReachable(page, width);

        if (inline) {
          const box = (await undo.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(35.5);
          expect(box.height).toBeGreaterThanOrEqual(35.5);
          expect(box.x).toBeGreaterThanOrEqual(-0.5);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
          // RTL keeps the order logical: Undo is on the start side of Redo.
          const redoBox = (await redo.boundingBox())!;
          if (locale === 'ar') expect(box.x).toBeGreaterThan(redoBox.x);
          else expect(box.x).toBeLessThan(redoBox.x);
          await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-dirty.png`) });

          await undo.click();
          expect(await lifecycle(page)).toBe('clean');
          await expect(redo).toHaveAttribute('aria-disabled', 'false');
          await redo.click();
          expect(await lifecycle(page)).toBe('dirty');
        } else {
          await page.getByRole('button', { name: new RegExp(MORE[locale]) }).click();
          const menu = page.getByRole('menu', { name: MORE[locale] });
          await page.waitForTimeout(300);
          const box = (await menu.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
          await expect(menu.getByRole('menuitem', { name: LABEL[locale].undo })).toBeEnabled();
          await expect(menu.getByRole('menuitem', { name: LABEL[locale].redo })).toBeDisabled();
          await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-more-menu.png`) });
          await menu.getByRole('menuitem', { name: LABEL[locale].undo }).click();
          expect(await lifecycle(page)).toBe('clean');
        }
      });
    }
  }

  test('EN 1280 — keyboard: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z from the page; the native shortcut stays inside a text field', async ({ page }) => {
    await openBuilder(page, 'en', 1280);
    await edit(page, '#123456');
    expect(await lifecycle(page)).toBe('dirty');

    // Inside a text field the editor must not act.
    await page.evaluate(() => (document.querySelector('[data-e2e-target]') as HTMLInputElement).focus());
    await page.keyboard.press('Control+z');
    expect(await lifecycle(page)).toBe('dirty');

    // From a non-text control (the Undo button's neighbour, Save) the shortcut reaches the editor.
    await page.locator('[data-save]').focus();
    await page.keyboard.press('Control+z');
    expect(await lifecycle(page)).toBe('clean');
    await page.keyboard.press('Control+y');
    expect(await lifecycle(page)).toBe('dirty');
    await page.keyboard.press('Control+z');
    expect(await lifecycle(page)).toBe('clean');
    await page.keyboard.press('Control+Shift+z');
    expect(await lifecycle(page)).toBe('dirty');
    await page.screenshot({ path: path.join(evidenceDir, 'en-1280-keyboard.png') });
  });

  test('EN 1280 — focus stays on the Undo button after the last Undo (aria-disabled, not disabled)', async ({ page }) => {
    await openBuilder(page, 'en', 1280);
    await edit(page, '#123456');
    const undo = page.locator('[data-history-action="undo"]');
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(undo).toHaveAttribute('aria-disabled', 'true');
    await expect(undo).toBeFocused();
    // The visible focus ring is perceivable.
    await page.screenshot({ path: path.join(evidenceDir, 'en-1280-focus-after-last-undo.png') });
  });

  test('AR 1280 — Save is a hard boundary in the browser: after Save both controls are unavailable', async ({ page }) => {
    await openBuilder(page, 'ar', 1280);
    await edit(page, '#123456');
    await expect(page.locator('[data-history-action="undo"]')).toHaveAttribute('aria-disabled', 'false');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'clean');
    await expect(page.locator('[data-history-action="undo"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-history-action="redo"]')).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: path.join(evidenceDir, 'ar-1280-after-save.png') });
  });

  test('AR 1280 — a Published Version is read-only: both controls unavailable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=published-readonly');
    await page.waitForSelector('[data-experience-builder]');
    await page.waitForTimeout(600);
    await expect(page.locator('[data-history-action="undo"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-history-action="redo"]')).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: path.join(evidenceDir, 'ar-1280-published.png') });
  });
});
