/**
 * AWJ-VD-H1 / VD-5 — the facet visual editor against a REAL stack (admin web -> Laravel -> Postgres/R2).
 *
 * Needs a live, seeded stack and is therefore skipped unless `VD5_STACK_ENV` names its env json (see
 * `playwright.vd5.config.ts`). It is not run in CI, like the other stack-dependent specs. Every fixture is created
 * through the public API under a unique `qa-w-` tag and removed afterwards; nothing the stack was seeded with is touched.
 *
 * Journeys:
 *  1. create a value -> upload an image through the real MediaRefField -> shape / size / label / fit / focal / zoom /
 *     identity -> live preview -> save -> hard reload -> reopen -> every setting persisted (and equals the API document),
 *     and «restore inheritance» removes a key (D-08).
 *  2. an image withdrawn from the library: the real API refuses to withdraw a referenced image (409 media_in_use), a
 *     withdrawn *pick* fails the save with 422 media_not_found and stores nothing, and the corrupt state the API
 *     cannot produce (a stored image whose media is gone) is simulated at the network boundary to see the documented
 *     «deleted» fallback.
 *  3. stale-save conflict between two browser contexts (409 with a stored identity, 428/409 for a first write): the
 *     loser sees the message, Reload recovers, and no update is lost.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  createFacet,
  createValue,
  FACETS,
  loadStack,
  makePng,
  openAdminContext,
  openMerchandising,
  publicGet,
  putFacetVisual,
  putValueVisual,
  readFacet,
  readValue,
  recordApi,
  runTag,
  type SeededFacet,
  type SeededValue,
  type Stack,
  StackApi,
  stackEnvPath,
  uploadMedia,
} from './support/vd5-stack';

test.skip(!stackEnvPath(), 'VD5_STACK_ENV is not set: this spec needs a live, seeded Laravel + admin stack (see playwright.vd5.config.ts)');

test.describe.configure({ mode: 'serial' });

let stack: Stack;
let api: StackApi;
const tag = runTag();
const createdFacets: string[] = [];
const createdMedia: string[] = [];
let fixtureProductId: string | null = null;
/** Different bytes on every run: the library de-duplicates by content hash and would answer "Already in the library". */
const bytesSeed = Number.parseInt(tag.slice(-6), 16) % 200;

test.beforeAll(() => {
  stack = loadStack();
  api = new StackApi(stack.api, stack.ownerToken);
});

test.afterAll(async () => {
  if (!api) return;
  // Best effort, in dependency order: release the shared fixture product (unpublish + unassign: a product that has ever been
  // used cannot be deleted, so one inactive-by-default fixture is reused across runs) -> facets (their visuals go with
  // them; a dimension that still has an assigned product cannot be deleted) -> media nothing references any more.
  if (fixtureProductId) {
    await api.request('PUT', `/commerce/workspace/products/${fixtureProductId}/publication`, { json: { storefront_ids: [] } }).catch(() => undefined);
    await api.request('PUT', `/commerce/workspace/products/${fixtureProductId}/facets`, { json: { value_ids: [] } }).catch(() => undefined);
  }
  for (const id of createdFacets) await api.request('DELETE', `${FACETS}/${id}`).catch(() => undefined);
  // Images this run uploaded (also through the picker UI): found by the tag in their file name.
  const library = await api.request('GET', '/commerce/workspace/storefront-media').catch(() => null);
  for (const item of library?.data?.data ?? []) if (String(item.name ?? '').includes(tag)) createdMedia.push(item.id);
  for (const id of new Set(createdMedia)) await api.request('DELETE', `/commerce/workspace/storefront-media/${id}`).catch(() => undefined);
});

async function seedFacet(suffix: string, defaults?: Record<string, unknown>): Promise<SeededFacet> {
  const facet = await createFacet(api, `${tag}-${suffix}`, `بُعد اختبار ${tag} ${suffix}`, `QA dimension ${tag} ${suffix}`);
  createdFacets.push(facet.id);
  if (defaults) {
    const result = await putFacetVisual(api, facet.id, { defaults }, null);
    expect(result.status, 'facet defaults saved').toBe(200);
  }
  return facet;
}

async function seedMedia(name: string, colour: [number, number, number], seed: number): Promise<string> {
  const id = await uploadMedia(api, `${tag}-${name}.png`, makePng(640, 480, colour, seed + bytesSeed));
  createdMedia.push(id);
  return id;
}

async function adminPage(browser: import('@playwright/test').Browser, locale: 'ar' | 'en' = 'en') {
  const context = await openAdminContext(browser, stack, { locale });
  const page = await context.newPage();
  const calls = recordApi(page, stack);
  return { context, page, calls };
}

function editorOf(page: Page): Locator {
  return page.locator('[data-facet-visual-editor]');
}

async function openValueEditor(page: Page, valueId: string, tab?: 'Data' | 'Image & icon' | 'Appearance'): Promise<Locator> {
  await page.locator(`[data-open-editor="${valueId}"]`).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  if (tab) await editor.getByRole('tab', { name: tab, exact: true }).click();
  return editor;
}

/** The frame of the tile that shows the value being edited in the live preview (the edited tile carries the image). */
function previewFrame(editor: Locator): Locator {
  return editor.locator('aside [data-preview-edited] [data-facet-content] > span[aria-hidden="true"]').first();
}

async function frameStyle(frame: Locator) {
  return frame.evaluate((el) => {
    const s = getComputedStyle(el);
    return { aspect: s.aspectRatio, width: el.getBoundingClientRect().width, mask: s.maskImage || s.webkitMaskImage, clip: s.clipPath, radius: s.borderRadius };
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

test('1. journey: create a value, upload an image, shape it, save, hard reload, everything persisted', async ({ browser }) => {
  const facet = await seedFacet('journey', {
    content: 'icon',
    icon: 'gift',
    iconColor: '#7c2d12',
    background: '#ffedd5',
    shape: 'hexagon',
    size: 'sm',
    showLabel: true,
  });
  const { context, page, calls } = await adminPage(browser);
  try {
    await openMerchandising(page);

    // ── quick add (data only) -> «Customize appearance» opens the full editor on the Image tab
    const row = page.locator(`[data-facet-row="${facet.id}"]`);
    await row.getByRole('button', { name: 'Add value' }).click();
    await page.getByLabel('Arabic name').fill('قيمة الرحلة');
    await page.getByLabel('English name (optional)').fill('Journey value');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // the follow-up is offered while the list is still reloading; wait for the new row (clicking the follow-up before the list reload finishes closes the editor before it shows)
    await expect(row.getByText('Journey value')).toBeVisible();
    await page.getByRole('button', { name: 'Customize appearance' }).click();
    const editor = editorOf(page);
    await expect(editor).toBeVisible();
    expect(calls.filter((c) => c.path.endsWith('/visual')), 'no identity is written before the row exists and the user saves').toHaveLength(0);

    const created = (await readFacet(api, facet.id)).values.find((v: any) => v.name === 'قيمة الرحلة');
    expect(created, 'value created through the quick-add dialog').toBeTruthy();
    const valueId: string = created.id;
    expect(created.visual).toBeNull();

    // ── inheritance is visible before anything is customised
    await expect(editor.getByRole('tab', { name: 'Image & icon', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('[data-content-now]')).toContainText('Icon');
    await editor.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(editor.locator('[data-prop="shape"] [data-state-badge="facet"]')).toContainText('Inherited from the dimension: Hexagon');
    await expect(editor.locator('[data-restore="shape"]')).toHaveCount(0);
    await editor.getByRole('tab', { name: 'Image & icon', exact: true }).click();

    // ── upload an image through the REAL MediaRefField / MediaPicker
    await editor.locator('[data-option="image"]').click();
    await editor.locator('[data-media-pick="facet-own"]').click();
    const picker = page.locator('[data-media-picker]');
    await picker.getByRole('tab', { name: 'Upload' }).click();
    await picker.locator('input[type=file]').setInputFiles({ name: `${tag}-journey.png`, mimeType: 'image/png', buffer: makePng(640, 480, [30, 120, 200], 7 + bytesSeed) });
    await expect(picker.locator('[data-media-uploads]')).toContainText('Uploaded', { timeout: 60_000 });
    await picker.locator('[data-media-uploads]').getByRole('button', { name: 'Use', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(editor.locator('[data-media-field="facet-own"]')).toContainText(`${tag}-journey.png`);

    // a freshly picked image is decorative by default; give it real alt text in both languages
    const decorative = editor.locator('[data-media-field="facet-own"] input[type=checkbox]');
    await expect(decorative).toBeChecked();
    await decorative.uncheck();
    await editor.locator('[data-media-alt="ar"]').fill('صورة رحلة الاختبار');
    await editor.locator('[data-media-alt="en"]').fill('Journey test picture');
    // the fallback icon (shown if the picture cannot be); colours stay inherited
    await editor.locator('[data-icon-option="cake"]').click();
    await expect(editor.locator('[data-icon-option="cake"]')).toHaveAttribute('aria-pressed', 'true');

    // ── appearance: every control, each reflected in the live preview
    await editor.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const frame = previewFrame(editor);
    await expect(frame.locator('img')).toBeVisible();

    await editor.locator('[data-shape-option="arch"]').click();
    await expect(editor.locator('[data-shape-option="arch"]')).toHaveAttribute('aria-pressed', 'true');
    let style = await frameStyle(frame);
    expect(style.aspect.replace(/\s/g, '')).toBe('3/4');
    expect(style.mask, 'the arch is an SVG mask, not a border radius').toContain('url(');
    await expect(editor.locator('[data-restore="shape"]')).toBeVisible();

    // the size steps are 56 / 80 / 112 px; the narrow preview cell caps the frame, so only "small" is asserted exactly here
    await editor.locator('[data-option="sm"]').click();
    expect(Math.round((await frameStyle(frame)).width)).toBe(56);
    await editor.locator('[data-option="lg"]').click();
    style = await frameStyle(frame);
    expect(style.width).toBeGreaterThan(56);

    await editor.getByRole('switch', { name: 'Show the name' }).click();
    await expect(editor.getByRole('switch', { name: 'Show the name' })).toHaveAttribute('aria-checked', 'false');
    await expect(editor.locator('aside [data-preview-edited] [data-facet-content] > span').last()).toHaveClass(/sr-only/);

    await editor.locator('[data-option="contain"]').click();
    await editor.locator('[data-focal-option="100-0"]').click();
    await editor.locator('input[type=range]').fill('1.4');
    const img = frame.locator('img');
    await expect(img).toHaveCSS('object-fit', 'contain');
    await expect(img).toHaveCSS('object-position', '100% 0%');
    await expect.poll(async () => img.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1.4, 0, 0, 1.4, 0, 0)');

    // ── data tab
    await editor.getByRole('tab', { name: 'Data', exact: true }).click();
    await editor.getByLabel('English name (optional)').fill('Journey value (edited)');

    // ── save: data first, then identity, one click
    const before = calls.length;
    await editor.locator('[data-save]').click();
    await expect(editor).toBeHidden({ timeout: 30_000 });
    const writes = calls.slice(before).filter((c) => c.method === 'PUT');
    expect(writes.map((c) => c.path)).toEqual([`${FACETS}/${facet.id}/values/${valueId}`, `${FACETS}/${facet.id}/values/${valueId}/visual`]);
    expect(writes.map((c) => c.status)).toEqual([200, 200]);
    expect(writes[1].body.expected_version, 'first identity write for a row with no identity yet').toBeNull();

    // ── the stored document equals what was set — and nothing inherited was copied into it
    const mediaId: string = (await readValue(api, facet.id, valueId)).visual.image.mediaId;
    createdMedia.push(mediaId);
    const expected = {
      content: 'image',
      image: { mediaId, alt: { ar: 'صورة رحلة الاختبار', en: 'Journey test picture' }, fit: 'contain', focal: { x: 100, y: 0 }, zoom: 1.4 },
      icon: 'cake',
      shape: 'arch',
      size: 'lg',
      showLabel: false,
    };
    let stored = await readValue(api, facet.id, valueId);
    expect(stored.visual).toEqual(expected);
    expect(stored.name_en).toBe('Journey value (edited)');
    expect(stored.visual_version).toBe(1);
    const version1 = stored.visual_version;

    // ── hard reload, reopen: every setting is back, in the UI as well
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-facet-row]').first().waitFor({ timeout: 120_000 });
    const reopened = await openValueEditor(page, valueId, 'Data');
    await expect(reopened.getByLabel('English name (optional)')).toHaveValue('Journey value (edited)');
    await expect(reopened.getByLabel('Arabic name')).toHaveValue('قيمة الرحلة');

    await reopened.getByRole('tab', { name: 'Image & icon', exact: true }).click();
    await expect(reopened.locator('[data-option="image"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.locator('[data-media-field="facet-own"]')).toContainText(`${tag}-journey.png`);
    await expect(reopened.locator('[data-media-field="facet-own"] input[type=checkbox]')).not.toBeChecked();
    await expect(reopened.locator('[data-media-alt="ar"]')).toHaveValue('صورة رحلة الاختبار');
    await expect(reopened.locator('[data-media-alt="en"]')).toHaveValue('Journey test picture');
    await expect(reopened.locator('[data-icon-option="cake"]')).toHaveAttribute('aria-pressed', 'true');
    // colours were never overridden: still inherited from the dimension, no restore button
    await expect(reopened.locator('[data-prop="iconColor"] [data-state-badge="facet"]')).toContainText('#7c2d12');
    await expect(reopened.locator('[data-prop="background"] [data-state-badge="facet"]')).toContainText('#ffedd5');
    await expect(reopened.locator('[data-restore="iconColor"]')).toHaveCount(0);
    await expect(reopened.locator('[data-restore="background"]')).toHaveCount(0);

    await reopened.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(reopened.locator('[data-shape-option="arch"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.locator('[data-option="lg"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.getByRole('switch', { name: 'Show the name' })).toHaveAttribute('aria-checked', 'false');
    await expect(reopened.locator('[data-option="contain"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.locator('[data-focal-option="100-0"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.locator('input[type=range]')).toHaveValue('1.4');
    for (const key of ['shape', 'size', 'showLabel', 'fit', 'focal', 'zoom']) {
      await expect(reopened.locator(`[data-restore="${key}"]`), `restore button for ${key}`).toBeVisible();
    }
    // the preview, drawn from the stored document, shows the same frame as before the save
    await expect(previewFrame(reopened).locator('img')).toBeVisible();
    style = await frameStyle(previewFrame(reopened));
    expect(style.aspect.replace(/\s/g, '')).toBe('3/4');
    expect(style.width).toBeGreaterThan(56);

    // ── D-08: restoring the inheritance of one property removes exactly that key
    await reopened.locator('[data-restore="shape"]').click();
    await expect(reopened.locator('[data-prop="shape"] [data-state-badge="facet"]')).toContainText('Inherited from the dimension: Hexagon');
    await expect(reopened.locator('[data-shape-option="hexagon"]')).toHaveAttribute('aria-pressed', 'true');
    await reopened.locator('[data-save]').click();
    await expect(reopened).toBeHidden({ timeout: 30_000 });
    stored = await readValue(api, facet.id, valueId);
    const { shape: _removed, ...withoutShape } = expected;
    expect(stored.visual).toEqual(withoutShape);
    expect(stored.visual_version).toBe(version1 + 1);
  } finally {
    await context.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

test('2. withdrawn image: protected at the API, 422 for a withdrawn pick, documented fallback for a missing stored image', async ({ browser }) => {
  const facet = await seedFacet('withdraw');
  const value: SeededValue = await createValue(api, facet.id, 'قيمة السحب', 'Withdrawal value');
  const stored = await seedMedia('stored', [200, 70, 70], 11);
  const picked = await seedMedia('picked', [60, 160, 90], 23);
  const saved = await putValueVisual(api, facet.id, value.id, { content: 'image', image: { mediaId: stored, fit: 'cover', alt: { ar: 'مخزنة', en: 'Stored' } }, shape: 'circle' }, null);
  expect(saved.status).toBe(200);

  // The product contract: a referenced image cannot be withdrawn through the API at all.
  const refused = await api.request('DELETE', `/commerce/workspace/storefront-media/${stored}`);
  expect(refused.status).toBe(409);
  expect(refused.data?.code ?? refused.data?.error?.code ?? JSON.stringify(refused.data)).toContain('media_in_use');

  const { context, page, calls } = await adminPage(browser);
  try {
    await openMerchandising(page);
    const editor = await openValueEditor(page, value.id, 'Image & icon');
    await expect(editor.locator('[data-media-field="facet-own"]')).toContainText(`${tag}-stored.png`);

    // pick another library image (still unreferenced) …
    await editor.getByRole('button', { name: 'Replace' }).click();
    const picker = page.locator('[data-media-picker]');
    // (the library search box is deliberately not used: `GET storefront-media?q=` answers 500 on PostgreSQL — the newest image is on the first page)
    await picker.locator(`[data-media-card="${picked}"]`).getByRole('button', { name: 'Use' }).click();
    await expect(picker).toBeHidden();
    await expect(editor.locator('[data-media-field="facet-own"]')).toContainText(`${tag}-picked.png`);

    // … which another user withdraws from the library before this one saves
    const withdrawn = await api.request('DELETE', `/commerce/workspace/storefront-media/${picked}`);
    expect(withdrawn.status, 'an unreferenced image can be withdrawn').toBe(200);

    // leaving the tab and coming back re-reads the asset: the field says it is gone
    await editor.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await editor.getByRole('tab', { name: 'Image & icon', exact: true }).click();
    await expect(editor.locator('[data-media-stale]')).toBeVisible();

    const before = calls.length;
    await editor.locator('[data-save]').click();
    await expect(editor.locator('[data-save-part="visual"][data-save-status="failed"]')).toContainText('Some appearance settings are invalid');
    await expect(editor.locator('[data-visual-error="own:image"]')).toContainText('This image is no longer in the library. Choose another image.');
    await expect(editor.locator('[data-tab-panel="image"] [data-error-code="media_not_found"]')).toBeVisible();
    await expect(editor.getByRole('tab', { name: /Image & icon/ })).toContainText('This tab has an error');
    await expect(editor).toBeVisible();
    const attempts = calls.slice(before).filter((c) => c.method === 'PUT');
    expect(attempts, 'exactly one attempt, no automatic retry').toHaveLength(1);
    expect(attempts[0].status).toBe(422);

    // nothing was stored: the document and its version are untouched, and the withdrawn id is nowhere in it
    const after = await readValue(api, facet.id, value.id);
    expect(after.visual.image.mediaId).toBe(stored);
    expect(JSON.stringify(after.visual)).not.toContain(picked);
    expect(after.visual_version).toBe(1);

    // choosing another image clears the field error (and the tab alert)
    await editor.locator('[data-media-remove="facet-own"]').click();
    await expect(editor.locator('[data-error-code="media_not_found"]')).toHaveCount(0);
  } finally {
    await context.close();
  }

  // The storefront-facing projection exposes the stored image only (never the withdrawn pick). It needs a product of this
  // tenant published on the second storefront; skipped when the env names none.
  if (stack.storefrontHost && stack.storefrontId) {
    const sku = 'qa-w-vd5-spec';
    const existing = ((await api.request('GET', '/products')).data?.data ?? []).find((p: any) => p.sku === sku);
    let productId: string = existing?.id;
    if (!productId) {
      const product = await api.request('POST', '/products', {
        json: { name: 'منتج مواصفة VD-5', name_en: 'VD-5 spec product', sku, type: 'good', unit: 'piece', sale_price: 1000, tax_rate: 15, track_inventory: false, is_active: true },
      });
      expect(product.status).toBe(201);
      productId = (product.data.data ?? product.data).id;
    }
    fixtureProductId = productId;
    expect((await api.request('PUT', `/commerce/workspace/products/${productId}/facets`, { json: { value_ids: [value.id] } })).status).toBe(200);
    expect((await api.request('PUT', `/commerce/workspace/products/${productId}/publication`, { json: { storefront_ids: [stack.storefrontId] } })).status).toBe(200);

    const listing = await publicGet(stack.laravel, `/store/v1/products?per_page=1&facet[${facet.key}]=${value.slug}`, stack.storefrontHost);
    expect(listing.status).toBe(200);
    const projected = (listing.data.meta.facets as any[]).find((f) => f.key === facet.key)?.values.find((v: any) => v.slug === value.slug);
    expect(projected?.visual, 'the stored identity is projected').toBeTruthy();
    const text = JSON.stringify(projected.visual);
    expect(text).toContain(stored);
    expect(text).not.toContain(picked);
    expect(text, 'the admin-only signed preview and version never reach the storefront').not.toMatch(/visual_preview|visual_version|expires=|signature=/);
  }

  // The state the API refuses to create (a stored image whose media is gone) — simulated at the network boundary.
  const sim = await adminPage(browser);
  try {
    await sim.page.route(
      (url) => url.pathname === new URL(stack.api).pathname + FACETS,
      async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const f of body.data.facets) for (const v of f.values) if (v.id === value.id) v.visual_preview = null;
        await route.fulfill({ response, json: body });
      },
    );
    await sim.page.route(
      (url) => url.pathname === `${new URL(stack.api).pathname}/commerce/workspace/storefront-media/${stored}`,
      (route) => route.fulfill({ status: 404, contentType: 'application/json', json: { message: 'Not found' } }),
    );
    await openMerchandising(sim.page);
    const editor = await openValueEditor(sim.page, value.id, 'Image & icon');
    await expect(editor.locator('[data-image-state="deleted"]')).toContainText('This image was deleted from the library; the fallback shows. Choose another image.');
    await expect(editor.locator('[data-media-stale]')).toBeVisible();
    // the preview falls back (initial letter, no broken <img>) and the stored document is not touched by merely opening
    await expect(editor.locator('aside [data-preview-edited] [data-facet-content]').first()).not.toHaveAttribute('data-facet-content', 'image');
    await expect(editor.locator('aside img')).toHaveCount(0);
    await expect(editor.locator('[data-save]')).toBeDisabled();
    expect((await readValue(api, facet.id, value.id)).visual_version).toBe(1);
  } finally {
    await sim.context.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

test('3. stale save between two browser contexts: conflict message, Reload recovers, no lost update', async ({ browser }) => {
  const facet = await seedFacet('conflict');
  const withIdentity = await createValue(api, facet.id, 'قيمة بهوية', 'With identity');
  const firstWrite = await createValue(api, facet.id, 'قيمة بلا هوية', 'No identity yet');
  expect((await putValueVisual(api, facet.id, withIdentity.id, { content: 'none', shape: 'circle', size: 'md' }, null)).status).toBe(200);

  const a = await adminPage(browser);
  const b = await adminPage(browser);
  try {
    await Promise.all([openMerchandising(a.page), openMerchandising(b.page)]);

    // ── case 1: an identity already exists, so the stale token is a 409 (or 428 when the server demands the token)
    const editorA = await openValueEditor(a.page, withIdentity.id, 'Appearance');
    const editorB = await openValueEditor(b.page, withIdentity.id, 'Appearance');
    await editorB.locator('[data-shape-option="square"]').click();
    await editorB.locator('[data-save]').click();
    await expect(editorB).toBeHidden({ timeout: 30_000 });

    await editorA.locator('[data-option="lg"]').click();
    const beforeA = a.calls.length;
    await editorA.locator('[data-save]').click();
    const conflict = editorA.locator('[data-save-part="visual"][data-save-status="failed"]');
    await expect(conflict).toContainText('The identity was changed by another user. Reload to see the latest version.');
    await expect(editorA).toBeVisible();
    const attempt = a.calls.slice(beforeA).filter((c) => c.method === 'PUT');
    expect(attempt, 'one attempt, never retried over a version the user has not seen').toHaveLength(1);
    expect([409, 428]).toContain(attempt[0].status);
    test.info().annotations.push({ type: 'stale-write status (identity exists)', description: String(attempt[0].status) });
    // nothing of A's was applied
    let current = await readValue(api, facet.id, withIdentity.id);
    expect(current.visual).toEqual({ content: 'none', shape: 'square', size: 'md' });

    await conflict.getByRole('button', { name: 'Reload' }).click();
    const reloaded = editorOf(a.page);
    await expect(reloaded.getByRole('tab', { name: 'Appearance', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(reloaded.locator('[data-shape-option="square"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reloaded.locator('[data-option="md"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reloaded.locator('[data-save-part]')).toHaveCount(0);
    // a retry on the fresh version now succeeds and both writers' work survives
    await reloaded.locator('[data-option="lg"]').click();
    await reloaded.locator('[data-save]').click();
    await expect(reloaded).toBeHidden({ timeout: 30_000 });
    current = await readValue(api, facet.id, withIdentity.id);
    expect(current.visual).toEqual({ content: 'none', shape: 'square', size: 'lg' });
    expect(current.visual_version).toBe(3);

    // ── case 2: a value with no identity row yet — both editors hold "no version", the second write must lose
    const firstA = await openValueEditor(a.page, firstWrite.id, 'Appearance');
    const firstB = await openValueEditor(b.page, firstWrite.id, 'Appearance');
    await firstB.locator('[data-shape-option="star"]').click();
    await firstB.locator('[data-save]').click();
    await expect(firstB).toBeHidden({ timeout: 30_000 });

    await firstA.locator('[data-option="sm"]').click();
    const beforeFirst = a.calls.length;
    await firstA.locator('[data-save]').click();
    await expect(firstA.locator('[data-save-part="visual"][data-save-status="failed"]')).toContainText('changed by another user');
    const stale = a.calls.slice(beforeFirst).filter((c) => c.method === 'PUT');
    expect(stale).toHaveLength(1);
    expect([409, 428]).toContain(stale[0].status);
    test.info().annotations.push({ type: 'stale-write status (first write)', description: String(stale[0].status) });
    const kept = await readValue(api, facet.id, firstWrite.id);
    expect(kept.visual).toEqual({ shape: 'star' });

    await firstA.locator('[data-save-part="visual"]').getByRole('button', { name: 'Reload' }).click();
    const fresh = editorOf(a.page);
    await expect(fresh.locator('[data-shape-option="star"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(fresh.locator('[data-option="sm"]')).toHaveAttribute('aria-pressed', 'false');
    expect((await readValue(api, facet.id, firstWrite.id)).visual).toEqual({ shape: 'star' });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
