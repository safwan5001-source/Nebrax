import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H4-7 — real browser visual QA for the Offers section: the merchant
 * picker (live/hidden rows with reasons, prices + discount badge, select,
 * reorder, remove, max 8) and the Canvas rendering real, server-evaluated
 * offers. Same `/dev/customizer-versions` fixture as CUST-H4-2…H4-5 (mounts
 * the real `ExperienceBuilder` in demo mode — no Laravel server, no login).
 * `MOCK_WORKSPACE_OFFERS` returns pre-evaluated rows in the real workspace
 * payload shape (dev fixture only — the live/hidden evaluation itself is the
 * backend's `StorefrontOfferResolver`, covered by the H4-6 suite).
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h4-7-offers');

async function waitForBuilderReady(page: Page) {
  await page.waitForSelector('[data-experience-builder]');
  await page.waitForTimeout(400);
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** Adds an "offers" Home section via the real Section Library and leaves it selected. */
async function addOffersSection(page: Page, isMobile: boolean, homeLabel: string) {
  if (isMobile) {
    if ((await page.getByRole('dialog').count()) === 0) {
      await page.getByRole('button', { name: /إضافة قسم|Add section/ }).first().click();
    }
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /إضافة قسم|Add section/ }).click();
    await sheet.locator('[data-picker-option="offers"]').click();
    return;
  }
  await page.getByRole('button', { name: homeLabel }).click();
  await page.locator('[data-add-section]').click();
  await page.locator('[data-picker-option="offers"]').click();
}

function panelOf(page: Page, isMobile: boolean): Locator {
  const locator = '[data-selected-section-settings="offers"]';
  return isMobile ? page.getByRole('dialog').locator(locator) : page.locator(locator);
}

async function load(page: Page, locale: 'ar' | 'en', width: number, height = 1000, offers = '') {
  await page.setViewportSize({ width, height });
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft${offers ? `&offers=${offers}` : ''}`);
  await page.waitForLoadState('networkidle');
  await waitForBuilderReady(page);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H4-7 — Offers picker + Canvas (visual)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const width of [390, 430]) {
    test(`AR ${width} — picker rows (live + hidden reasons), select, reorder, remove`, async ({ page }) => {
      await load(page, 'ar', width, 900);
      await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'rtl');

      await addOffersSection(page, true, 'الصفحة الرئيسية');
      const panel = panelOf(page, true);
      await expect(panel.getByText('لم تُختَر عروض بعد.')).toBeVisible();

      // Real configured offers, with live and hidden states in text.
      await expect(panel.locator('[data-offers-option]')).toHaveCount(12);
      const live = panel.locator('[data-offers-option="offer-headphones"]');
      await expect(live).toContainText('ظاهر الآن');
      await expect(live).toContainText('خصم 24%');
      const hidden = panel.locator('[data-offers-option="offer-scheduled"]');
      await expect(hidden).toContainText('غير ظاهر');
      await expect(hidden).toContainText('لم تبدأ فترته بعد');

      await panel.locator('[data-offers-option="offer-headphones"]').click();
      await panel.locator('[data-offers-option="offer-helmet"]').click();
      await panel.locator('[data-offers-option="offer-scheduled"]').click();
      await expect(panel.locator('[data-offers-selected] >> text=3/8')).toBeVisible();

      // Reorder: move the second selected row up, remove the hidden one.
      const items = panel.locator('[data-offers-selected-item]');
      await items.nth(1).getByRole('button', { name: /نقل العرض لأعلى/ }).click();
      await expect(items.first()).toContainText('خوذة دراجة هوائية');
      await items.nth(2).getByRole('button', { name: /إزالة العرض من الاختيار/ }).click();
      await expect(panel.locator('[data-offers-selected] >> text=2/8')).toBeVisible();

      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-offers-picker.png`), fullPage: true });
    });
  }

  test('AR desktop — Canvas shows only live offers in stored order with real price + discount', async ({ page }) => {
    await load(page, 'ar', 1440, 1000);
    await addOffersSection(page, false, 'الصفحة الرئيسية');
    const panel = panelOf(page, false);

    // Stored order deliberately differs from the workspace list order, and a
    // hidden (scheduled) + a deleted-product offer are selected too.
    for (const id of ['offer-watch', 'offer-headphones', 'offer-scheduled', 'offer-deleted-product', 'offer-helmet', 'offer-sub-percent', 'offer-long-name']) {
      await panel.locator(`[data-offers-option="${id}"]`).click();
    }
    await expect(panel.locator('[data-offers-selected] >> text=7/8')).toBeVisible();
    await expect(panel.locator('[data-offers-unavailable]')).toHaveCount(0); // deleted product still has a row (product_unavailable)
    await expect(panel.locator('[data-offers-selected-item]').nth(3)).toContainText('عرض لم يعد متاحاً');

    const canvas = page.locator('[data-preview-canvas]');
    const section = canvas.locator('section[aria-labelledby^="preview-offers-"]');
    await expect(section).toBeVisible();
    const cards = section.locator('[data-home-offer-card]');
    // 5 live selected (watch, headphones, helmet, sub-percent, long-name); the scheduled + deleted ones are omitted.
    await expect(cards).toHaveCount(5);
    await expect(cards.nth(0)).toContainText('ساعة ذكية');
    await expect(cards.nth(0).locator('[data-home-offer-badge]')).toHaveText('خصم 27%');
    await expect(cards.nth(1)).toContainText('سماعة لاسلكية');
    await expect(cards.nth(2)).toContainText('خوذة دراجة هوائية');
    // 0% genuine discount draws no badge but keeps both prices.
    await expect(cards.nth(3)).toContainText('حقيبة ظهر يومية');
    await expect(cards.nth(3).locator('[data-home-offer-badge]')).toHaveCount(0);
    await expect(cards.nth(3).locator('[data-home-offer-reference]')).toBeVisible();
    await expect(section).not.toContainText('كاميرا رقمية');

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-offers-canvas.png'), fullPage: true });
  });

  test('AR desktop — hidden / unavailable selected offers are honest in the editor and absent on the Canvas', async ({ page }) => {
    await load(page, 'ar', 1440, 1000);
    await addOffersSection(page, false, 'الصفحة الرئيسية');
    const panel = panelOf(page, false);
    for (const id of ['offer-scheduled', 'offer-out-of-stock', 'offer-expired', 'offer-deleted-product', 'offer-variant']) {
      await panel.locator(`[data-offers-option="${id}"]`).click();
    }
    const selected = panel.locator('[data-offers-selected]');
    await expect(selected).toContainText('لم تبدأ فترته بعد');
    await expect(selected).toContainText('غير متوفر في المخزون');
    await expect(selected).toContainText('انتهت فترته');
    await expect(selected).toContainText('المنتج متعدد الخيارات');
    await expect(selected).toContainText('المنتج غير نشط أو غير منشور على هذا المتجر');

    const section = page.locator('[data-preview-canvas] section[aria-labelledby^="preview-offers-"]');
    await expect(section.locator('[data-home-offer-card]')).toHaveCount(0);
    await expect(section.locator('[data-home-offers-none-live]')).toBeVisible();

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-offers-hidden.png'), fullPage: true });
  });

  test('AR desktop — max 8 is enforced and reorder/remove stay available', async ({ page }) => {
    await load(page, 'ar', 1440, 1100);
    await addOffersSection(page, false, 'الصفحة الرئيسية');
    const panel = panelOf(page, false);
    for (const id of [
      'offer-helmet', 'offer-headphones', 'offer-sub-percent', 'offer-long-name',
      'offer-watch', 'offer-lamp', 'offer-scheduled', 'offer-out-of-stock',
    ]) {
      await panel.locator(`[data-offers-option="${id}"]`).click();
    }
    await expect(panel.locator('[data-offers-selected] >> text=8/8')).toBeVisible();
    await expect(panel.getByText('الحد الأقصى 8 عروض.')).toBeVisible();
    await expect(panel.locator('[data-offers-option="offer-expired"]')).toBeDisabled();
    await expect(panel.locator('[data-offers-option="offer-helmet"]')).toBeEnabled();

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-offers-max8.png'), fullPage: true });
  });

  for (const [name, mode, locator] of [
    ['empty (no offers configured)', 'empty', '[data-offers-picker-empty]'],
    ['error with retry', 'error', '[data-offers-picker-error]'],
  ] as const) {
    test(`AR desktop — picker ${name}`, async ({ page }) => {
      await load(page, 'ar', 1440, 900, mode);
      await addOffersSection(page, false, 'الصفحة الرئيسية');
      const panel = panelOf(page, false);
      await expect(panel.locator(locator)).toBeVisible();
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-desktop-offers-${mode}.png`), fullPage: true });
    });
  }

  // Below 1280px the builder's sidebar is not part of the shell (a pre-existing
  // layout rule, unrelated to Offers), so the selection is made at desktop
  // width and the host window is then resized: this verifies the Offers
  // Canvas itself at 768 / 1024 / 1280 host widths with no horizontal overflow.
  //
  // NOTE (pre-existing, not Offers): once the draft is dirty, the builder's
  // *header toolbar* (Save/Publish/Schedule) is wider than 768/1024px and
  // widens the document by ~28–40px. Verified identical with a plain banner
  // section added instead of Offers, so the document-level check is replaced
  // here by a check scoped to the Offers section and its preview scroller.
  for (const width of [768, 1024, 1280]) {
    test(`AR ${width} — Canvas with real offers, no horizontal overflow`, async ({ page }) => {
      await load(page, 'ar', 1440, 1000);
      await addOffersSection(page, false, 'الصفحة الرئيسية');
      const panel = panelOf(page, false);
      for (const id of ['offer-helmet', 'offer-long-name', 'offer-sub-percent', 'offer-headphones']) {
        await panel.locator(`[data-offers-option="${id}"]`).click();
      }
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(800); // the preview re-fits (scales) to the new host width
      const section = page.locator('[data-preview-canvas] section[aria-labelledby^="preview-offers-"]');
      await expect(section.locator('[data-home-offer-card]')).toHaveCount(4);
      const fit = await section.evaluate((el) => {
        const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-home-offer-card]'));
        const scroller = el.closest<HTMLElement>('[data-preview-canvas]');
        return {
          sectionOverflows: el.scrollWidth > el.clientWidth + 1,
          // A card's own content must stay inside the card's box (the card box
          // is measured post-scale, so compare descendants against it rather
          // than scrollWidth, which differs from clientWidth by the border).
          cardsOverflowSection: cards.some((card) => {
            const box = card.getBoundingClientRect();
            return Array.from(card.querySelectorAll<HTMLElement>('*')).some((child) => {
              const r = child.getBoundingClientRect();
              // 2px slack: the preview is a scaled-down device frame, so
              // sub-pixel text metrics can poke a fraction past the box edge.
              return r.right > box.right + 2 || r.left < box.left - 2;
            });
          }),
          canvasInsideViewport: !scroller || scroller.getBoundingClientRect().right <= window.innerWidth + 1,
        };
      });
      expect(fit).toEqual({ sectionOverflows: false, cardsOverflowSection: false, canvasInsideViewport: true });
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-offers-canvas.png`), fullPage: true });
    });
  }

  test('AR desktop — Canvas simulated tablet and mobile device widths', async ({ page }) => {
    await load(page, 'ar', 1440, 1000);
    await addOffersSection(page, false, 'الصفحة الرئيسية');
    const panel = panelOf(page, false);
    for (const id of ['offer-helmet', 'offer-long-name', 'offer-sub-percent', 'offer-headphones']) {
      await panel.locator(`[data-offers-option="${id}"]`).click();
    }
    const section = page.locator('[data-preview-canvas] section[aria-labelledby^="preview-offers-"]');
    for (const [label, file] of [['جهاز لوحي', 'tablet'], ['جوال', 'mobile']] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(300);
      await expect(section.locator('[data-home-offer-card]')).toHaveCount(4);
      await assertNoOverflow(page);
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidenceDir, `ar-desktop-canvas-${file}-offers.png`), fullPage: true });
    }
  });

  test('EN desktop (LTR) — picker and Canvas', async ({ page }) => {
    await load(page, 'en', 1440, 1000);
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'ltr');
    await addOffersSection(page, false, 'Homepage');
    const panel = panelOf(page, false);
    await expect(panel.getByText('No offers selected yet.')).toBeVisible();
    for (const id of ['offer-helmet', 'offer-headphones', 'offer-scheduled']) {
      await panel.locator(`[data-offers-option="${id}"]`).click();
    }
    await expect(panel.locator('[data-offers-option="offer-headphones"]')).toContainText('24% off');
    await expect(panel.locator('[data-offers-option="offer-scheduled"]')).toContainText("Its period hasn't started yet");
    const section = page.locator('[data-preview-canvas] section[aria-labelledby^="preview-offers-"]');
    await expect(section.locator('[data-home-offer-card]')).toHaveCount(2);
    await expect(section.locator('[data-home-offer-badge]').first()).toHaveText('21% off');

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-desktop-offers.png'), fullPage: true });
  });
});
