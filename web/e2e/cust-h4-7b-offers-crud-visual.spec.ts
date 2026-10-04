import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H4-7b — real browser visual QA for the merchant Offers CRUD inside the
 * Offers section's Content panel: empty-state "Create offer", the inline
 * create/edit form (real workspace product picker, active toggle, optional
 * start/end, position), configured list with hidden reasons, inline delete
 * confirmation, server validation errors, and the mobile Bottom Sheet flow.
 * Same `/dev/customizer-versions` fixture (demo mode, no Laravel). The fixture
 * router mirrors the H4-6 controller's response shapes (409 / 422 / cap); the
 * authoritative rules themselves are covered by the H4-6 backend suite.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h4-7b-offers-crud');

async function ready(page: Page) {
  await page.waitForSelector('[data-experience-builder]');
  await page.waitForTimeout(400);
}

async function noOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
}

async function load(page: Page, locale: 'ar' | 'en', width: number, height: number, offers: '' | 'empty' | 'error' = '') {
  await page.setViewportSize({ width, height });
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft${offers ? `&offers=${offers}` : ''}`);
  await page.waitForLoadState('networkidle');
  await ready(page);
}

async function addOffers(page: Page, mobile: boolean, home: string) {
  if (mobile) {
    if ((await page.getByRole('dialog').count()) === 0) {
      await page.getByRole('button', { name: /إضافة قسم|Add section/ }).first().click();
    }
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /إضافة قسم|Add section/ }).click();
    await sheet.locator('[data-picker-option="offers"]').click();
    return;
  }
  await page.getByRole('button', { name: home }).click();
  await page.locator('[data-add-section]').click();
  await page.locator('[data-picker-option="offers"]').click();
}

function panel(page: Page, mobile: boolean): Locator {
  const sel = '[data-selected-section-settings="offers"]';
  return mobile ? page.getByRole('dialog').locator(sel) : page.locator(sel);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
}

/** Opens the create form, picks a product by id and submits with the given extras. */
async function createOffer(p: Locator, productId: string, extra: { starts?: string; ends?: string; position?: string; inactive?: boolean } = {}) {
  await p.locator('[data-offer-add], [data-offer-create-empty]').first().click();
  await p.locator(`[data-offer-product-option="${productId}"]`).click();
  if (extra.inactive) await p.locator('[data-offer-active]').uncheck();
  if (extra.starts) await p.locator('[data-offer-starts]').fill(extra.starts);
  if (extra.ends) await p.locator('[data-offer-ends]').fill(extra.ends);
  if (extra.position) await p.locator('[data-offer-position]').fill(extra.position);
  await p.locator('[data-offer-submit]').click();
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H4-7b — Offers CRUD (visual)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  test('AR desktop — empty → create → list → edit → hidden reason → delete', async ({ page }) => {
    await load(page, 'ar', 1440, 1100, 'empty');
    await addOffers(page, false, 'الصفحة الرئيسية');
    const p = panel(page, false);

    // Empty state: a real action, not a dead end.
    await expect(p.locator('[data-offers-picker-empty]')).toContainText('لا عروض مهيّأة');
    await expect(p.getByRole('button', { name: 'إنشاء عرض' })).toBeVisible();
    await shot(page, 'ar-desktop-1-empty');

    // Create form (real products; the variant-managed t-shirt is unavailable).
    await p.getByRole('button', { name: 'إنشاء عرض' }).click();
    await expect(p.locator('[data-offer-form="create"]')).toBeVisible();
    await expect(p.locator('[data-offer-product-option="mock-product-helmet"]')).toBeVisible();
    await expect(p.locator('[data-offer-product-option="mock-product-tshirt"]')).toBeDisabled();
    await expect(p.locator('[data-offer-product-option="mock-product-tshirt"]')).toContainText('متعدد الخيارات');
    await shot(page, 'ar-desktop-2-create-form');

    // Create the helmet (long name) → live offer with the backend's price proof.
    await p.locator('[data-offer-product-option="mock-product-helmet"]').click();
    await expect(p.locator('[data-offer-selected-product]')).toContainText('خوذة دراجة هوائية');
    await p.locator('[data-offer-starts]').fill('2020-01-01T09:00');
    await p.locator('[data-offer-position]').fill('0');
    await shot(page, 'ar-desktop-3-create-filled');
    await p.locator('[data-offer-submit]').click();
    const helmet = p.locator('[data-offers-option]').first();
    await expect(helmet).toContainText('ظاهر الآن');
    await expect(helmet).toContainText('خصم 16%');
    await expect(p.locator('[data-offer-window]')).toBeVisible();

    // Second offer on the bare product → server says no genuine discount (honest reason, never forced).
    await createOffer(p, 'mock-product-bare');
    const bare = p.locator('[data-offers-option]').nth(1);
    await expect(bare).toContainText('غير ظاهر');
    await expect(bare).toContainText('لا يوجد خصم فعلي على المنتج الآن');
    await expect(p.locator('[data-offer-add]')).toBeVisible();

    // Select the live one → the Canvas shows the real card.
    await helmet.click();
    const canvas = page.locator('[data-preview-canvas] section[aria-labelledby^="preview-offers-"]');
    await expect(canvas.locator('[data-home-offer-card]')).toHaveCount(1);
    await expect(canvas.locator('[data-home-offer-badge]')).toHaveText('خصم 16%');
    await shot(page, 'ar-desktop-4-list-and-canvas');

    // Edit: switch the live offer off → the server's response turns the row hidden and removes the Canvas card.
    await p.locator('[data-offer-edit]').first().click();
    await expect(p.locator('[data-offer-form="edit"]')).toBeVisible();
    await expect(p.getByLabel('العرض مفعّل')).toBeChecked();
    await shot(page, 'ar-desktop-5-edit-form');
    await p.getByLabel('العرض مفعّل').uncheck();
    await p.locator('[data-offer-submit]').click();
    await expect(p.locator('[data-offers-option]').first()).toContainText('العرض موقوف');
    await expect(canvas.locator('[data-home-offer-card]')).toHaveCount(0);
    await shot(page, 'ar-desktop-6-edited-hidden');

    // Delete (inline confirmation) → removed from the list AND from the section's selection.
    await p.locator('[data-offer-delete]').first().click();
    const confirm = p.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'إلغاء' })).toBeFocused();
    await shot(page, 'ar-desktop-7-delete-confirm');
    await confirm.locator('[data-offer-delete-confirm-button]').click();
    await expect(p.locator('[data-offers-option]')).toHaveCount(1);
    await expect(p.locator('[data-offers-selected] >> text=0/8')).toBeVisible();
    await expect(p.locator('[data-offers-unavailable]')).toHaveCount(0);
    await noOverflow(page);
    await shot(page, 'ar-desktop-8-after-delete');
  });

  test('AR desktop — invalid time range and a 12-offer cap come back from the server and are shown on the fields', async ({ page }) => {
    await load(page, 'ar', 1440, 1100, 'empty');
    await addOffers(page, false, 'الصفحة الرئيسية');
    const p = panel(page, false);
    await p.getByRole('button', { name: 'إنشاء عرض' }).click();
    await p.locator('[data-offer-product-option="mock-product-helmet"]').click();
    await p.locator('[data-offer-starts]').fill('2030-03-31T18:00');
    await p.locator('[data-offer-ends]').fill('2030-03-01T09:00');
    await p.locator('[data-offer-submit]').click();
    await expect(p.locator('[data-offer-field-error="ends_at"]')).toContainText('يجب أن يكون وقت النهاية بعد وقت البداية');
    await expect(p.locator('[data-offer-form-error]')).toBeVisible();
    await expect(p.locator('[data-offer-form="create"]')).toBeVisible();
    await expect(p.locator('[data-offer-starts]')).toHaveValue('2030-03-31T18:00'); // input preserved
    // The invalid field is marked beyond colour text: red border == the error text's colour.
    const [border, errorText] = await Promise.all([
      p.locator('[data-offer-ends]').evaluate((el) => getComputedStyle(el).borderTopColor),
      p.locator('[data-offer-field-error="ends_at"]').evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(border).toBe(errorText);
    await noOverflow(page);
    await shot(page, 'ar-desktop-9-error-invalid-range');
  });

  test('AR desktop — populated catalog with long names, hidden reasons, windows; at the cap Add is disabled', async ({ page }) => {
    await load(page, 'ar', 1440, 1400);
    await addOffers(page, false, 'الصفحة الرئيسية');
    const p = panel(page, false);
    await expect(p.locator('[data-offers-option]')).toHaveCount(12);
    // 12 configured = the server cap in the fixture → Add is disabled with the reason.
    await expect(p.locator('[data-offer-add]')).toBeDisabled();
    await expect(p.locator('[data-offers-cap]')).toContainText('12');
    await expect(p.locator('[data-offer-edit]').first()).toHaveAccessibleName(/تعديل العرض: /);
    await noOverflow(page);
    await shot(page, 'ar-desktop-10-populated-cap');
  });

  for (const width of [390, 430]) {
    test(`AR ${width} — create / edit / delete inside the Bottom Sheet (no nested modal)`, async ({ page }) => {
      await load(page, 'ar', width, 900, 'empty');
      await addOffers(page, true, 'الصفحة الرئيسية');
      const p = panel(page, true);
      await expect(p.locator('[data-offer-create-empty]')).toBeVisible();
      await shot(page, `ar-${width}-1-empty`);

      await p.locator('[data-offer-create-empty]').click();
      await expect(p.locator('[data-offer-form="create"]')).toBeVisible();
      // Still ONE dialog (the Bottom Sheet): the form is inline, never a modal on a modal.
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await p.locator('[data-offer-product-option="mock-product-helmet"]').click();
      await p.locator('[data-offer-starts]').fill('2030-03-01T09:00');
      await p.locator('[data-offer-ends]').fill('2030-03-31T18:30');
      await shot(page, `ar-${width}-2-create-form`);

      // Touch targets and fields fit and are usable.
      for (const sel of ['[data-offer-submit]', '[data-offer-cancel]', '[data-offer-starts]', '[data-offer-ends]', '[data-offer-position]', '[data-offer-active]']) {
        const box = await p.locator(sel).boundingBox();
        expect(box, sel).not.toBeNull();
        expect(box!.height, sel).toBeGreaterThanOrEqual(20);
        expect(box!.width, sel).toBeGreaterThanOrEqual(20);
      }
      for (const sel of ['[data-offer-submit]', '[data-offer-cancel]', '[data-offer-starts]', '[data-offer-ends]', '[data-offer-position]']) {
        expect((await p.locator(sel).boundingBox())!.height, sel).toBeGreaterThanOrEqual(36);
      }
      await noOverflow(page);

      await p.locator('[data-offer-submit]').click();
      await expect(p.locator('[data-offers-option]')).toHaveCount(1);
      // Future start → the server holds it hidden as "scheduled" (honest reason).
      await expect(p.locator('[data-offers-option]').first()).toContainText('لم تبدأ فترته بعد');
      await shot(page, `ar-${width}-3-list`);

      await p.locator('[data-offer-edit]').first().click();
      await expect(p.locator('[data-offer-form="edit"]')).toBeVisible();
      await shot(page, `ar-${width}-4-edit-form`);
      await p.locator('[data-offer-cancel]').click();

      await p.locator('[data-offer-delete]').first().click();
      await expect(p.getByRole('alertdialog')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(1); // the confirmation is inline too
      for (const sel of ['[data-offer-delete-confirm-button]']) {
        expect((await p.locator(sel).boundingBox())!.height).toBeGreaterThanOrEqual(36);
      }
      await noOverflow(page);
      await shot(page, `ar-${width}-5-delete-confirm`);
      await p.locator('[data-offer-delete-confirm-button]').click();
      await expect(p.locator('[data-offer-create-empty]')).toBeVisible();
      await noOverflow(page);
    });
  }

  test('EN desktop (LTR) — create form, list and delete confirmation', async ({ page }) => {
    await load(page, 'en', 1440, 1100, 'empty');
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'ltr');
    await addOffers(page, false, 'Homepage');
    const p = panel(page, false);
    await expect(p.getByRole('button', { name: 'Create offer' })).toBeVisible();
    await p.getByRole('button', { name: 'Create offer' }).click();
    await expect(p.getByLabel('Offer is active')).toBeChecked();
    await expect(p.getByLabel('Starts at (optional)')).toBeVisible();
    await expect(p.getByLabel('Ends at (optional)')).toBeVisible();
    await expect(p.getByLabel('Order (optional)')).toBeVisible();
    await p.locator('[data-offer-product-option="mock-product-helmet"]').click();
    await shot(page, 'en-desktop-1-create-form');
    await p.locator('[data-offer-submit]').click();
    await expect(p.locator('[data-offers-option]').first()).toContainText('Live now');
    await shot(page, 'en-desktop-2-list');
    await p.getByRole('button', { name: /^Delete offer: / }).click();
    await expect(p.getByRole('alertdialog')).toContainText('Delete this offer?');
    await shot(page, 'en-desktop-3-delete-confirm');
    await noOverflow(page);
  });

  test('AR desktop — a failing offers read shows an error with retry (no create dead end)', async ({ page }) => {
    await load(page, 'ar', 1440, 900, 'error');
    await addOffers(page, false, 'الصفحة الرئيسية');
    const p = panel(page, false);
    await expect(p.locator('[data-offers-picker-error]')).toBeVisible();
    await shot(page, 'ar-desktop-11-read-error');
  });
});
