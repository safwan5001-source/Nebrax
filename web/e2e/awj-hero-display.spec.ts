import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * AWJ-HERO-DISPLAY — the merchant path for the Hero display options, in a real browser against the REAL `ExperienceBuilder`:
 * add a Hero → toggle title / description / buttons → set a picture link → the Canvas preview changes immediately → Save draft →
 * Publish → the published (read-only) view still shows the same hero.
 *
 * Scope, stated plainly: the builder runs here on the repository's own dev fixture route (`/dev/customizer-versions`, the demo mock
 * presentation store — no Laravel, no login; see its header). That store lives in the page's memory and is re-seeded on every load, so
 * "survives a reload" CANNOT be proven on this route. That half is proven on the real stack instead — HTTP + database, no mocks — by
 * `tests/Feature/StorefrontPresentationHeroDisplayLifecycleTest.php` (save → re-read → publish → public runtime), and the published
 * markup by the storefront `HeroSection` tests and the real-Chromium proofs in the implementation report.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/awj-hero-display');
const URL = '/dev/customizer-versions?locale=en&scenario=single-draft';

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', 'one explicit desktop viewport — the preview width is simulated inside the builder');
});

async function openHeroPanel(page: Page) {
  await page.goto(URL);
  await page.waitForSelector('[data-experience-builder]');
  await page.locator('[data-panel-option]', { hasText: 'Homepage' }).click();
  await page.getByRole('button', { name: /Add section/ }).click();
  await page.locator('[data-picker-option="hero"]').click();
  await expect(page.locator('[data-hero-fields]')).toBeVisible();
}

const hero = (page: Page) => page.locator('[data-preview-frame] section[aria-label="Hero"]');
const toggle = (page: Page, label: string) => page.getByLabel(label, { exact: true }).first();
/** the switch's checkbox is visually replaced by a track: click its <label>, as a merchant does */
async function setSwitch(page: Page, label: string, on: boolean) {
  const box = toggle(page, label);
  if ((await box.isChecked()) !== on) await box.locator('xpath=ancestor::label[1]').click();
  await expect(box).toBeChecked({ checked: on });
}
const lifecycle = (page: Page) => page.locator('[data-experience-builder]').getAttribute('data-lifecycle');

test('Hero → image only → picture link → Save → Publish: the preview follows every choice and the published view keeps it', async ({ page }) => {
  await openHeroPanel(page);

  // 1) text and a button: all parts visible, nothing hidden by default
  await page.getByLabel('Hero headline').fill('Spring collection');
  await page.getByLabel('Supporting line').fill('Fresh flowers every day');
  await expect(hero(page).locator('[data-preview-hero-heading]')).toHaveText('Spring collection');
  await expect(hero(page).locator('[data-preview-hero-heading]')).not.toHaveClass(/sr-only/);
  await expect(hero(page)).toContainText('Fresh flowers every day');
  await expect(hero(page)).toContainText('Shop all'); // the default button of a hero with no authored buttons
  await expect(toggle(page, 'Show title')).toBeChecked();

  // 2) one part at a time: the preview updates at once and leaves nothing behind
  await setSwitch(page, 'Show description', false);
  await expect(hero(page)).not.toContainText('Fresh flowers every day');
  await expect(hero(page).locator('p')).toHaveCount(0);

  await setSwitch(page, 'Show buttons', false);
  await expect(hero(page)).not.toContainText('Shop all'); // hiding the buttons hides the default one as well

  // 3) image only: no visible heading either, and no content box (no empty container)
  await setSwitch(page, 'Show title', false);
  const heading = hero(page).locator('[data-preview-hero-heading]');
  await expect(heading).toHaveClass(/sr-only/);
  await expect(heading).toHaveText('Spring collection'); // still the section's heading for assistive technology
  await expect(hero(page).locator('[data-section-content]')).toHaveCount(0);
  await expect(page.locator('[data-hero-image-only]')).toBeVisible();
  expect(await lifecycle(page)).toBe('dirty');

  // 4) the picture link (committed on blur, like the button links)
  const link = page.getByLabel('Image link (optional)');
  await link.fill('/collections/new');
  await link.blur();
  await expect(link).toHaveValue('/collections/new');
  await page.screenshot({ path: path.join(evidenceDir, 'desktop-image-only-edited.png') });

  // 5) Save draft
  await page.locator('[data-save]').click();
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'clean');
  await expect(toggle(page, 'Show title')).not.toBeChecked();
  await expect(link).toHaveValue('/collections/new');

  // 6) Publish (the confirmation names what goes live), then the read-only published view shows the same image-only hero
  await page.locator('[data-publish]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Publish now|Publish/ }).last().click();
  await expect(page.getByRole('status').first()).toBeVisible();
  await expect(hero(page).locator('[data-section-content]')).toHaveCount(0);
  await expect(hero(page).locator('[data-preview-hero-heading]')).toHaveClass(/sr-only/);
  await page.screenshot({ path: path.join(evidenceDir, 'desktop-image-only-published.png') });
});

test('turning a part back on restores it in the preview (nothing is lost while hidden)', async ({ page }) => {
  await openHeroPanel(page);
  await page.getByLabel('Hero headline').fill('Welcome');
  await page.getByLabel('Supporting line').fill('Kept while hidden');
  await setSwitch(page, 'Show description', false);
  await expect(hero(page)).not.toContainText('Kept while hidden');
  await setSwitch(page, 'Show description', true);
  await expect(hero(page)).toContainText('Kept while hidden');
});

test('deleting a hero whose only edit is a display choice asks for confirmation (review on #1645); an untouched hero deletes at once', async ({ page }) => {
  // an untouched hero (empty headline, nothing chosen): nothing to lose, so no confirmation
  await openHeroPanel(page);
  await page.locator('[data-section-action="remove"]').click();
  await expect(hero(page)).toHaveCount(0);

  // the same hero after ONE display choice: the canvas asks first, and the hero stays until confirmed
  await openHeroPanel(page);
  await setSwitch(page, 'Show buttons', false);
  await page.locator('[data-section-action="remove"]').click();
  await expect(page.getByRole('button', { name: 'Yes, delete' })).toBeVisible();
  await expect(hero(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(hero(page)).toHaveCount(1);
});
