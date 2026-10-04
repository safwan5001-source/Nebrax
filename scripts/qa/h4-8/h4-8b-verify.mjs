import { browser, login, WEB, API, SEED, OUT, log, checks } from './lib.mjs';

const { ok, finish } = checks();

const tok = (await (await fetch(`${API}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ email: SEED.email, password: SEED.password }),
})).json()).token;

const wsApi = (m, p, body) => fetch(`${API}/api/commerce/workspace/storefronts/${SEED.storefrontA}${p}`, {
  method: m, headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

// Create a real offer for product A (the one with attached media) so the
// Offers Canvas section has a live, image-bearing card to render.
const offerRes = await wsApi('POST', '/offers', { product_id: SEED.products.A });
ok(offerRes.status === 201, `offer created for product A (status ${offerRes.status})`);
const offerAId = offerRes.json.data.id;
log('offer A id:', offerAId, 'thumbnail_url:', offerRes.json.data.product?.thumbnail_url);
ok(!!offerRes.json.data.product?.thumbnail_url, 'offer A payload carries a thumbnail_url');
ok(!/\/commerce\/v1\/media/.test(offerRes.json.data.product?.thumbnail_url ?? ''), 'offer A thumbnail_url is NOT the bearer-gated /commerce/v1/media route');

// Workspace product list payload (feeds New Arrivals / Featured pickers).
const listRes = await wsApi('GET', '/products?sort=newest');
const rowA = listRes.json.data.find((p) => p.id === SEED.products.A);
log('workspace product A thumbnail_url:', rowA?.thumbnail_url);
ok(!!rowA?.thumbnail_url, 'workspace product list carries a thumbnail_url for product A');
ok(!/\/commerce\/v1\/media/.test(rowA?.thumbnail_url ?? ''), 'workspace product thumbnail_url is NOT /commerce/v1/media');

// Fetch the signed URL directly WITH NO Authorization header — the exact
// plain-<img> scenario that was broken before this fix (B1).
const imgUrl = rowA.thumbnail_url.startsWith('http') ? rowA.thumbnail_url : `${API}${rowA.thumbnail_url}`;
const plainImgFetch = await fetch(imgUrl); // deliberately no Authorization header
ok(plainImgFetch.status === 200, `plain unauthenticated fetch of workspace media URL returns 200 (got ${plainImgFetch.status})`);
ok((plainImgFetch.headers.get('content-type') || '').startsWith('image/'), 'response content-type is image/*');

// Configure the draft: New Arrivals visible, Featured includes product A,
// Offers includes the new live offer for product A.
let vs = (await wsApi('GET', '/presentation/versions')).json;
if (!vs.data.some((v) => v.state === 'draft')) {
  const created = await wsApi('POST', '/presentation/versions', { name: 'H4-8b QA draft' });
  ok(created.status === 201, `initial draft version created (status ${created.status})`);
  vs = (await wsApi('GET', '/presentation/versions')).json;
}
const draft = vs.data.find((v) => v.state === 'draft');
const full = (await wsApi('GET', `/presentation/versions/${draft.id}`)).json.data;
const cfg = full.config;
const secs = cfg.homepage.sections;
const set = (id, patch) => Object.assign(secs.find((x) => x.id === id), patch);
set('newArrivals', { visible: true });
set('featured', { visible: true, content: { productIds: [SEED.products.A] } });
set('offers', { visible: true, content: { offerIds: [offerAId] } });

const put = await wsApi('PUT', `/presentation/versions/${draft.id}`, { config: cfg, revision: full.revision });
ok(put.status === 200, `draft saved (status ${put.status})`);

const head = (await wsApi('GET', '/presentation/versions')).json.data;
const pub = head.find((v) => v.state === 'published');
const after = (await wsApi('GET', `/presentation/versions/${draft.id}`)).json.data;
const pr = await wsApi('POST', `/presentation/versions/${draft.id}/publish`, {
  revision: after.revision,
  expected_published_revision: pub?.published_revision ?? null,
  expected_active_version_id: pub?.id ?? null,
});
ok(pr.status === 200, `draft published (status ${pr.status})`);

// ── Real browser: open Canvas, verify each of the 3 surfaces actually renders the image ──
const b = await browser();
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

const mediaRequests = [];
page.on('request', (r) => {
  if (/\/media\//.test(r.url())) {
    mediaRequests.push({ url: r.url(), hasAuth: !!r.headers()['authorization'] });
  }
});
const mediaResponses = [];
page.on('response', (r) => {
  if (/\/media\//.test(r.url())) mediaResponses.push({ url: r.url(), status: r.status() });
});

await login(page);
await page.goto(`${WEB}/commerce/appearance`);
await page.waitForSelector('[data-experience-builder]', { timeout: 60000 });
await page.waitForTimeout(6000);

async function checkSection(labelSelector, name) {
  const section = page.locator(labelSelector).first();
  const img = section.locator('img').first();
  const count = await img.count();
  if (count === 0) {
    ok(false, `${name}: no <img> found in the section at all`);
    return;
  }
  await img.waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForTimeout(1500);
  const result = await img.evaluate((el) => ({
    src: el.src, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, complete: el.complete,
  }));
  log(`${name} img:`, JSON.stringify(result));
  ok(result.naturalWidth > 0 && result.complete, `${name}: real image loaded (naturalWidth=${result.naturalWidth}, complete=${result.complete})`);
  ok(!/\/commerce\/v1\/media/.test(result.src), `${name}: img src is not the bearer-gated /commerce/v1/media route`);
}

await checkSection('section[aria-labelledby="preview-arrivals"]', 'New Arrivals');
await checkSection('section[aria-labelledby^="preview-featured-"]', 'Featured');
await checkSection('section[aria-labelledby^="preview-offers-"]', 'Offers');

// Settle pass right before the screenshot: dev-mode (React 18 Strict Mode
// double-effect) can briefly re-show the skeleton after a section already
// resolved once above. Poll each section's own <img> until it is the real,
// decoded image (not the animate-pulse placeholder, which has no <img> at
// all) so the screenshot captures the final, settled state a merchant would
// actually see, not a mid-refetch flicker.
async function waitForRealImage(labelSelector, name, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const img = page.locator(labelSelector).locator('img').first();
    if ((await img.count()) > 0) {
      const w = await img.evaluate((el) => el.naturalWidth).catch(() => 0);
      if (w > 0) return true;
    }
    await page.waitForTimeout(300);
  }
  ok(false, `${name}: did not settle on a real loaded image before the screenshot (still showing skeleton after ${timeoutMs}ms)`);
  return false;
}
await waitForRealImage('section[aria-labelledby="preview-arrivals"]', 'New Arrivals (pre-screenshot)');
await waitForRealImage('section[aria-labelledby^="preview-featured-"]', 'Featured (pre-screenshot)');
await waitForRealImage('section[aria-labelledby^="preview-offers-"]', 'Offers (pre-screenshot)');
await page.waitForTimeout(500);

log('media network requests (browser):', JSON.stringify(mediaRequests));
log('media network responses (browser):', JSON.stringify(mediaResponses));
ok(mediaRequests.length > 0, 'the browser issued at least one real HTTP request for a workspace media URL');
ok(mediaRequests.every((r) => r.hasAuth === false), 'none of those <img>-triggered requests carried an Authorization header');
ok(mediaResponses.length > 0 && mediaResponses.every((r) => r.status === 200), 'every workspace media response was 200');

// The Canvas is an internally-scrolling panel (`[data-preview-canvas]`),
// not page-level scroll — `page.screenshot({fullPage:true})` captures the
// outer viewport only and can miss cards below the panel's own scroll
// fold. Screenshot the panel element itself (Playwright scrolls an element
// screenshot's target fully into view before capturing), which is also the
// more honest "what the merchant actually sees" frame per surface.
async function settleAfterResize(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  await waitForRealImage('section[aria-labelledby="preview-arrivals"]', `resize ${width}x${height} New Arrivals`);
  await waitForRealImage('section[aria-labelledby^="preview-featured-"]', `resize ${width}x${height} Featured`);
  await waitForRealImage('section[aria-labelledby^="preview-offers-"]', `resize ${width}x${height} Offers`);
  await page.waitForTimeout(300);
}

await settleAfterResize(1440, 1000);
await page.locator('[data-preview-canvas]').screenshot({ path: `${OUT}/h4-8b-canvas-desktop.png` });
await page.locator('section[aria-labelledby="preview-arrivals"]').screenshot({ path: `${OUT}/h4-8b-new-arrivals.png` });
await page.locator('section[aria-labelledby^="preview-featured-"]').screenshot({ path: `${OUT}/h4-8b-featured.png` });
await page.locator('section[aria-labelledby^="preview-offers-"]').screenshot({ path: `${OUT}/h4-8b-offers.png` });

await settleAfterResize(390, 844);
await page.locator('[data-preview-canvas]').screenshot({ path: `${OUT}/h4-8b-canvas-mobile-390.png` });
await page.locator('section[aria-labelledby="preview-arrivals"]').screenshot({ path: `${OUT}/h4-8b-new-arrivals-mobile.png` });
await page.locator('section[aria-labelledby^="preview-featured-"]').screenshot({ path: `${OUT}/h4-8b-featured-mobile.png` });
await page.locator('section[aria-labelledby^="preview-offers-"]').screenshot({ path: `${OUT}/h4-8b-offers-mobile.png` });

await b.close();
finish();
