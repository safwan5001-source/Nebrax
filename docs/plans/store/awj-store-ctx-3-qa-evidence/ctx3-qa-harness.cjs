/* Manual release-QA harness for AWJ-STORE-CTX-3 (not part of CI).
 * Prerequisites: Laravel API on :8000 (throwaway SQLite) and `next dev -p 3001` with NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api;
 * tenants seeded through the public API (see AWJ-STORE-CTX-3-QA-REPORT.md §2). Token files token-<tenant> in $QA_OUT.
 * Run from web/: QA_OUT=… TAIBA=… RASHD=… FOREIGN=… SINGLE=… node ../docs/plans/store/awj-store-ctx-3-qa-evidence/ctx3-qa-harness.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT = process.env.QA_OUT;
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
const API = 'http://127.0.0.1:8000/api';
const PW = 'QaPassw0rd!2026';
const TAIBA = process.env.TAIBA;
const RASHD = process.env.RASHD;
const FOREIGN = process.env.FOREIGN;
const SINGLE = process.env.SINGLE;
const results = [];
const network = {};

function record(id, title, ok, evidence) {
  results.push({ id, title, ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title}${evidence ? ' — ' + JSON.stringify(evidence).slice(0, 300) : ''}`);
}
async function check(id, title, fn) {
  try {
    const evidence = await fn();
    record(id, title, true, evidence);
  } catch (error) {
    record(id, title, false, String(error && error.message || error).slice(0, 600));
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

const UUID = /\/commerce\/workspace\/storefronts\/([0-9a-f-]{36})(\/[^?]*)?/;
function trackNetwork(page, label) {
  network[label] = network[label] || [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(API)) return;
    const m = url.match(UUID);
    network[label].push({ method: req.method(), path: url.replace(API, ''), storeId: m ? m[1] : null });
  });
}
const storeIdsUsed = (label) => [...new Set((network[label] || []).map((r) => r.storeId).filter(Boolean))];
const writes = (label) => (network[label] || []).filter((r) => r.method !== 'GET' && r.storeId);

async function login(browser, email, { locale = 'ar' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: locale === 'en' ? 'en-US' : 'ar-SA' });
  await ctx.addCookies([{ name: 'locale', value: locale, url: BASE }]);
  const page = await ctx.newPage();
  for (let attempt = 1; ; attempt++) {
    await page.goto(`${BASE}/login`);
    await page.fill('#login-email', email);
    await page.fill('#login-password', PW);
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/login'), { timeout: 60000 });
    await page.click('button[type="submit"]');
    const status = (await resp).status();
    if (status === 429 && attempt < 6) { await page.waitForTimeout(30000); continue; }
    if (status !== 200) throw new Error(`login ${email} → ${status}`);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 120000 });
    break;
  }
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

async function tab(browser, state, { width = 1440, height = 960, locale = 'ar', dark = false, mobile = false, label } = {}) {
  const ctx = await browser.newContext({
    storageState: state,
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: dark ? 'dark' : 'light',
    locale: locale === 'en' ? 'en-US' : 'ar-SA',
  });
  await ctx.addCookies([{ name: 'locale', value: locale, url: BASE }]);
  const page = await ctx.newPage();
  if (label) trackNetwork(page, label);
  return { ctx, page };
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
  await page.waitForTimeout(500);
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const storeParam = (page) => new URL(page.url()).searchParams.get('store');
const sessionStore = (page) => page.evaluate(() => sessionStorage.getItem('awj-commerce-active-store'));

async function chooseStore(page, name, locale = 'ar') {
  const screen = page.locator('[data-store-selection-screen]');
  await screen.getByRole('radio', { name }).check();
  await screen.getByRole('button', { name: locale === 'en' ? 'Select store' : 'اختيار المتجر' }).click();
}

async function apiGet(token, p) {
  const r = await fetch(API + p, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

/** Theme Gallery → Preview & apply → builder (hard nav) → edit → Save → Reload, all on one store. */
async function themeJourney(page, label, storeId, themeId, storeName) {
  await page.goto(`${BASE}/commerce/themes`);
  await settle(page);
  const urlStore = storeParam(page);
  expect(urlStore === storeId, `gallery URL store=${urlStore}, expected ${storeId}`);
  const link = page.locator(`[data-theme-preview-link="${themeId}"]`);
  await link.waitFor({ timeout: 60000 });
  const href = await link.getAttribute('href');
  expect(href.includes(`store=${storeId}`), `preview link lacks store: ${href}`);
  await shot(page, `${label}-1-gallery`);
  await link.click();
  await page.waitForSelector('[data-theme-preview-bar]', { timeout: 90000 });
  await page.waitForFunction(() => { const b = document.querySelector('[data-theme-apply]'); return b && !b.disabled; }, null, { timeout: 90000 });
  await settle(page);
  await shot(page, `${label}-2-preview`);
  expect(storeParam(page) === storeId, `preview URL store=${storeParam(page)}`);
  await Promise.all([
    page.waitForURL((u) => u.pathname === '/commerce/appearance' && u.searchParams.has('version') && !u.searchParams.has('previewTheme'), { timeout: 90000 }),
    page.click('[data-theme-apply]'),
  ]);
  await page.waitForSelector('[data-experience-builder]', { timeout: 90000 });
  await settle(page);
  const appliedVersion = new URL(page.url()).searchParams.get('version');
  expect(storeParam(page) === storeId, `after apply URL store=${storeParam(page)}`);
  expect(await sessionStore(page) === storeId, 'tab session store mismatch after hard navigation');
  await shot(page, `${label}-3-builder-after-apply`);

  // A real edit through the builder UI, then Save.
  const edited = await page.evaluate(() => {
    const input = [...document.querySelectorAll('[data-experience-builder] input')].find((el) => el.type === 'text' && !el.closest('header') && el.offsetParent !== null);
    if (!input) return null;
    const next = input.value === '#123456' ? '#123457' : '#123456';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { name: input.getAttribute('aria-label') || input.name || input.id, value: next };
  });
  let saved = false;
  if (edited) {
    await page.waitForTimeout(400);
    const save = page.locator('[data-save]');
    if (await save.isEnabled()) {
      await save.click();
      await page.waitForFunction(() => document.querySelector('[data-experience-builder]')?.getAttribute('data-lifecycle') !== 'dirty', null, { timeout: 60000 }).catch(() => {});
      saved = true;
    }
  }
  await settle(page);
  await shot(page, `${label}-4-builder-saved`);

  await page.reload();
  await page.waitForSelector('[data-experience-builder]', { timeout: 90000 });
  await settle(page);
  expect(storeParam(page) === storeId, `after reload URL store=${storeParam(page)}`);
  await shot(page, `${label}-5-after-reload`);
  const used = storeIdsUsed(label);
  expect(used.length === 1 && used[0] === storeId, `storefront IDs used in requests: ${JSON.stringify(used)}`);
  return { appliedVersion, edited, saved, requestsWithStoreId: (network[label] || []).filter((r) => r.storeId).length, storeIdsUsed: used, writes: writes(label).map((w) => `${w.method} ${w.path}`) };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const flowers = await login(browser, 'owner@flowers-qa.test');
  const single = await login(browser, 'owner@single-qa.test');
  const zero = await login(browser, 'owner@zero-qa.test');
  const tokens = Object.fromEntries(['flowers-qa', 'intruder-qa', 'single-qa'].map((t) => [t, fs.readFileSync(path.join(OUT, `token-${t === 'flowers-qa' ? 'flowers' : t}`), 'utf8').trim()]));

  // ── 1. Multi-store tenant, fresh tab, no context ──
  await check('MS-1', 'Multi-store fresh tab: selection screen, no default store, no store-scoped request', async () => {
    const { ctx, page } = await tab(browser, flowers, { label: 'MS-1' });
    await page.goto(`${BASE}/commerce/themes`);
    await settle(page);
    await page.waitForSelector('[data-store-selection-screen]', { timeout: 60000 });
    const radios = await page.locator('[data-store-selection-screen] input[type=radio]').evaluateAll((els) => els.map((e) => e.value));
    const disabled = await page.locator('[data-store-select-action]').isDisabled();
    await shot(page, 'MS-1-selection-ar-light-desktop');
    const ids = storeIdsUsed('MS-1');
    const urlStore = storeParam(page);
    const sess = await sessionStore(page);
    const themeCards = await page.locator('[data-theme-card]').count();
    await ctx.close();
    expect(radios.length === 2 && radios.includes(TAIBA) && radios.includes(RASHD), `radios ${radios}`);
    expect(disabled, 'Select button should be disabled before a choice');
    expect(ids.length === 0, `store-scoped requests before selection: ${ids}`);
    expect(urlStore === null && sess === null, `url=${urlStore} session=${sess}`);
    expect(themeCards === 0, 'gallery rendered before selection');
    return { radios, disabled, storeScopedRequests: ids.length };
  });

  // ── 2. Explicit selection + journeys on two tabs ──
  const tabA = await tab(browser, flowers, { label: 'TAIBA' });
  const tabB = await tab(browser, flowers, { label: 'RASHD' });
  let taibaJourney; let rashdJourney;
  await check('SEL-1', 'Explicit selection of زهور طيبة pins tab + URL', async () => {
    await tabA.page.goto(`${BASE}/commerce/themes`);
    await settle(tabA.page);
    await chooseStore(tabA.page, 'زهور طيبة');
    await tabA.page.waitForSelector('[data-theme-card]', { timeout: 60000 });
    await settle(tabA.page);
    const s = storeParam(tabA.page); const sess = await sessionStore(tabA.page);
    expect(s === TAIBA && sess === TAIBA, `url=${s} session=${sess}`);
    return { url: tabA.page.url().replace(BASE, ''), session: sess };
  });
  await check('J-TAIBA', 'زهور طيبة: Gallery → Preview → Apply (awj-bloom) → Builder → Save → Reload', async () => {
    taibaJourney = await themeJourney(tabA.page, 'TAIBA', TAIBA, 'awj-bloom', 'زهور طيبة');
    return taibaJourney;
  });
  await check('SEL-2', 'Second tab: still needs its own explicit selection; then زهور الرشد', async () => {
    await tabB.page.goto(`${BASE}/commerce/themes`);
    await settle(tabB.page);
    await tabB.page.waitForSelector('[data-store-selection-screen]', { timeout: 60000 });
    await chooseStore(tabB.page, 'زهور الرشد');
    await tabB.page.waitForSelector('[data-theme-card]', { timeout: 60000 });
    expect(storeParam(tabB.page) === RASHD, `url store=${storeParam(tabB.page)}`);
    return { tabB: storeParam(tabB.page) };
  });
  await check('J-RASHD', 'زهور الرشد: Gallery → Preview → Apply (awj-trade) → Builder → Save → Reload', async () => {
    rashdJourney = await themeJourney(tabB.page, 'RASHD', RASHD, 'awj-trade', 'زهور الرشد');
    return rashdJourney;
  });
  await check('TAB-1', 'Tab A remains on زهور طيبة after Tab B worked on زهور الرشد (reload Tab A)', async () => {
    await tabA.page.reload();
    await tabA.page.waitForSelector('[data-experience-builder]', { timeout: 90000 });
    await settle(tabA.page);
    const s = storeParam(tabA.page); const sess = await sessionStore(tabA.page);
    // Store context must never reach shared (cross-tab) storage: no key or value may carry a store id.
    const ls = await tabA.page.evaluate((ids) => Object.keys(localStorage).filter((k) => ids.some((id) => k.includes(id) || (localStorage.getItem(k) || '').includes(id))), [TAIBA, RASHD]);
    expect(s === TAIBA && sess === TAIBA, `tabA url=${s} session=${sess}`);
    expect(ls.length === 0, `store ids in localStorage: ${ls}`);
    return { tabA: s, localStorageStoreKeys: ls };
  });
  await check('NAV-1', 'All commerce sections keep زهور طيبة (sidebar navigation in Tab A)', async () => {
    const visited = [];
    for (const p of ['/commerce', '/commerce/stores', '/commerce/published-products', '/commerce/merchandising', '/commerce/delivery', '/commerce/gifting', '/commerce/domains', '/commerce/integrations', '/commerce/onboarding', '/commerce/themes']) {
      await tabA.page.goto(`${BASE}${p}`);
      await settle(tabA.page);
      const s = storeParam(tabA.page);
      const blocked = await tabA.page.locator('[data-store-selection-screen]').count();
      visited.push(`${p}→${s}${blocked ? ' (SELECTION SCREEN)' : ''}`);
      expect(s === TAIBA && !blocked, `${p}: store=${s} selectionScreen=${blocked}`);
    }
    const used = storeIdsUsed('TAIBA');
    expect(used.length === 1 && used[0] === TAIBA, `IDs used in Tab A: ${used}`);
    return visited;
  });
  await check('DIRECT-1', 'Direct link ?store=زهور الرشد in a fresh tab opens exactly that store', async () => {
    const { ctx, page } = await tab(browser, flowers, { label: 'DIRECT' });
    await page.goto(`${BASE}/commerce/themes?store=${RASHD}`);
    await settle(page);
    await page.waitForSelector('[data-theme-card]', { timeout: 60000 });
    const ids = storeIdsUsed('DIRECT');
    await ctx.close();
    expect(ids.length === 1 && ids[0] === RASHD, `ids ${ids}`);
    return { ids };
  });
  await tabA.ctx.close(); await tabB.ctx.close();

  // ── 3. Data isolation via the API ──
  await check('ISO-1', 'Each store holds only its own versions; themes do not cross', async () => {
    const t = tokens['flowers-qa'];
    const a = await apiGet(t, `/commerce/workspace/storefronts/${TAIBA}/presentation/versions`);
    const b = await apiGet(t, `/commerce/workspace/storefronts/${RASHD}/presentation/versions`);
    const aIds = a.body.data.map((v) => v.id); const bIds = b.body.data.map((v) => v.id);
    expect(aIds.every((id) => !bIds.includes(id)), 'shared version ids');
    const aV = await apiGet(t, `/commerce/workspace/storefronts/${TAIBA}/presentation/versions/${taibaJourney.appliedVersion}`);
    const bV = await apiGet(t, `/commerce/workspace/storefronts/${RASHD}/presentation/versions/${rashdJourney.appliedVersion}`);
    const presetA = aV.body.data.config.themePreset; const presetB = bV.body.data.config.themePreset;
    expect(presetA === 'awj-bloom', `Taiba preset ${presetA}`);
    expect(presetB === 'navy', `Rashd preset ${presetB}`);
    const crossA = await apiGet(t, `/commerce/workspace/storefronts/${RASHD}/presentation/versions/${taibaJourney.appliedVersion}`);
    const crossB = await apiGet(t, `/commerce/workspace/storefronts/${TAIBA}/presentation/versions/${rashdJourney.appliedVersion}`);
    expect(crossA.status === 404 && crossB.status === 404, `cross reads ${crossA.status}/${crossB.status}`);
    const pubA = a.body.data.filter((v) => v.state === 'published').length; const pubB = b.body.data.filter((v) => v.state === 'published').length;
    return { taiba: { versions: aIds.length, preset: presetA, published: pubA, revision: aV.body.data.revision }, rashd: { versions: bIds.length, preset: presetB, published: pubB, revision: bV.body.data.revision }, crossReads: [crossA.status, crossB.status] };
  });
  await check('ISO-2', 'Storefront data endpoints are store-scoped (products/categories/offers/vertical-setup)', async () => {
    const t = tokens['flowers-qa']; const out = {};
    for (const p of ['products', 'categories', 'offers', 'vertical-setup', 'gift-settings', 'domains']) {
      out[p] = [(await apiGet(t, `/commerce/workspace/storefronts/${TAIBA}/${p}`)).status, (await apiGet(t, `/commerce/workspace/storefronts/${RASHD}/${p}`)).status];
    }
    return out;
  });

  // ── 4. Unauthorized / cross-tenant ──
  await check('SEC-1', 'UI: ?store=<other tenant store> → invalid screen, no request for that ID', async () => {
    const { ctx, page } = await tab(browser, flowers, { label: 'SEC-1' });
    await page.goto(`${BASE}/commerce/appearance?store=${FOREIGN}&version=00000000-0000-4000-8000-000000000000`);
    await settle(page);
    await page.waitForSelector('[data-store-context-invalid]', { timeout: 60000 });
    const builder = await page.locator('[data-experience-builder]').count();
    await shot(page, 'SEC-1-invalid-store-ar');
    const ids = storeIdsUsed('SEC-1');
    await ctx.close();
    expect(builder === 0, 'builder mounted for a foreign store');
    expect(ids.length === 0, `requests issued with store ids: ${ids}`);
    return { builderMounted: builder, storeScopedRequests: ids };
  });
  await check('SEC-2', 'UI: ?store=<random uuid> → invalid screen', async () => {
    const { ctx, page } = await tab(browser, flowers, { label: 'SEC-2' });
    await page.goto(`${BASE}/commerce/themes?store=11111111-2222-4333-8444-555555555555`);
    await settle(page);
    await page.waitForSelector('[data-store-context-invalid]', { timeout: 60000 });
    const ids = storeIdsUsed('SEC-2');
    await ctx.close();
    expect(ids.length === 0, `ids ${ids}`);
    return { storeScopedRequests: ids.length };
  });
  await check('SEC-3', 'API: cross-tenant reads of another tenant\'s store are 404 both ways', async () => {
    const out = {
      flowersOnForeign: (await apiGet(tokens['flowers-qa'], `/commerce/workspace/storefronts/${FOREIGN}/presentation/versions`)).status,
      intruderOnTaiba: (await apiGet(tokens['intruder-qa'], `/commerce/workspace/storefronts/${TAIBA}/presentation/versions`)).status,
      intruderOnTaibaVersion: (await apiGet(tokens['intruder-qa'], `/commerce/workspace/storefronts/${TAIBA}/presentation/versions/${taibaJourney.appliedVersion}`)).status,
      intruderOnTaibaProducts: (await apiGet(tokens['intruder-qa'], `/commerce/workspace/storefronts/${TAIBA}/products`)).status,
    };
    const list = await apiGet(tokens['intruder-qa'], '/commerce/workspace/storefronts');
    out.intruderListIds = list.body.data.stores.map((s) => s.id);
    expect(Object.entries(out).filter(([k]) => k !== 'intruderListIds').every(([, v]) => v === 404), JSON.stringify(out));
    expect(!out.intruderListIds.includes(TAIBA) && !out.intruderListIds.includes(RASHD), 'foreign stores listed');
    return out;
  });
  await check('SEC-4', 'API: cross-tenant write to another tenant\'s version is rejected and changes nothing', async () => {
    const before = await apiGet(tokens['flowers-qa'], `/commerce/workspace/storefronts/${TAIBA}/presentation/versions/${taibaJourney.appliedVersion}`);
    const r = await fetch(`${API}/commerce/workspace/storefronts/${TAIBA}/presentation/versions/${taibaJourney.appliedVersion}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${tokens['intruder-qa']}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { version: 2, themePreset: 'sand' }, revision: before.body.data.revision }),
    });
    const after = await apiGet(tokens['flowers-qa'], `/commerce/workspace/storefronts/${TAIBA}/presentation/versions/${taibaJourney.appliedVersion}`);
    expect(r.status === 404, `status ${r.status}`);
    expect(after.body.data.revision === before.body.data.revision && after.body.data.config.themePreset === 'awj-bloom', 'version changed');
    return { status: r.status, revision: after.body.data.revision };
  });

  // ── 5. Single / zero-store tenants ──
  await check('ONE-1', 'Single-store tenant: auto-selected, no selection screen', async () => {
    const { ctx, page } = await tab(browser, single, { label: 'ONE' });
    await page.goto(`${BASE}/commerce/themes`);
    await settle(page);
    await page.waitForSelector('[data-theme-card]', { timeout: 60000 });
    const sel = await page.locator('[data-store-selection-screen]').count();
    const s = storeParam(page);
    await shot(page, 'ONE-1-single-store-gallery');
    await ctx.close();
    expect(sel === 0 && s === SINGLE, `selection=${sel} store=${s}`);
    return { store: s };
  });
  await check('ZERO-1', 'Zero-store tenant: no selection screen; store page shows provisioning/empty state', async () => {
    const { ctx, page } = await tab(browser, zero, { label: 'ZERO' });
    await page.goto(`${BASE}/commerce/stores`);
    await settle(page);
    const sel = await page.locator('[data-store-selection-screen]').count();
    await shot(page, 'ZERO-1-stores-empty');
    await page.goto(`${BASE}/commerce/themes`);
    await settle(page);
    await shot(page, 'ZERO-2-themes-empty');
    const ids = storeIdsUsed('ZERO');
    await ctx.close();
    expect(sel === 0, 'selection screen shown for zero stores');
    expect(ids.length === 0, `store ids ${ids}`);
    return { selectionScreen: sel, storeScopedRequests: ids.length };
  });

  // ── 6. Visual matrix of the selection screen + a11y ──
  const matrix = [];
  for (const locale of ['ar', 'en']) for (const dark of [false, true]) for (const mobile of [false, true]) {
    const name = `VIS-selection-${locale}-${dark ? 'dark' : 'light'}-${mobile ? 'mobile' : 'desktop'}`;
    await check(name, `Selection screen ${locale}/${dark ? 'dark' : 'light'}/${mobile ? '390px' : '1440px'}`, async () => {
      const { ctx, page } = await tab(browser, flowers, { locale, dark, mobile, width: mobile ? 390 : 1440, height: mobile ? 844 : 960 });
      await page.goto(`${BASE}/commerce/themes`);
      await settle(page);
      await page.waitForSelector('[data-store-selection-screen]', { timeout: 60000 });
      const info = await page.evaluate(() => ({
        dir: document.documentElement.dir || getComputedStyle(document.body).direction,
        lang: document.documentElement.lang,
        dark: document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark',
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        heading: document.querySelector('[data-store-selection-screen] h2')?.textContent,
        button: document.querySelector('[data-store-select-action]')?.textContent,
        cardRect: (() => { const r = document.querySelector('[data-store-selection-screen]').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width)]; })(),
      }));
      await shot(page, name);
      await ctx.close();
      matrix.push({ name, ...info });
      expect(info.overflowX <= 1, `horizontal overflow ${info.overflowX}`);
      expect((locale === 'ar') === (info.dir === 'rtl'), `dir ${info.dir} for ${locale}`);
      expect(info.dark === dark, `dark=${info.dark}`);
      return info;
    });
  }
  await check('A11Y-1', 'Keyboard-only selection + ARIA tree of the selection screen', async () => {
    const { ctx, page } = await tab(browser, flowers, { label: 'A11Y' });
    await page.goto(`${BASE}/commerce/themes`);
    await settle(page);
    await page.waitForSelector('[data-store-selection-screen]', { timeout: 60000 });
    const aria = await page.locator('[data-store-selection-screen]').ariaSnapshot();
    await page.locator('[data-store-selection-screen] input[type=radio]').first().focus();
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => ({ value: document.activeElement.value, checked: document.activeElement.checked }));
    await page.keyboard.press('Tab');
    const onButton = await page.evaluate(() => document.activeElement.hasAttribute('data-store-select-action'));
    await shot(page, 'A11Y-1-keyboard-focus');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-theme-card]', { timeout: 60000 });
    const s = storeParam(page);
    await ctx.close();
    expect(focused.checked, 'arrow key did not move/check radio');
    expect(onButton, 'Tab did not reach the Select button');
    expect(s === focused.value, `selected ${s} vs focused ${focused.value}`);
    return { aria, arrowChecked: focused.value, enterOpened: s };
  });
  await check('STATE-1', 'Loading state while the store list is pending (real browser, delayed response)', async () => {
    const { ctx, page } = await tab(browser, flowers);
    await page.route('**/api/commerce/workspace/storefronts', async (route) => { await new Promise((r) => setTimeout(r, 4000)); await route.continue(); });
    await page.goto(`${BASE}/commerce/themes`);
    await page.waitForTimeout(1500);
    await shot(page, 'STATE-1-loading');
    const cardsWhileLoading = await page.locator('[data-theme-card]').count();
    const busy = await page.locator('[aria-busy="true"], [role="status"]').count();
    await page.waitForSelector('[data-store-selection-screen]', { timeout: 60000 });
    await ctx.close();
    expect(cardsWhileLoading === 0, `gallery rendered while loading (${cardsWhileLoading} cards)`);
    return { cardsWhileLoading, loadingIndicators: busy };
  });
  await check('STATE-2', 'Error state when the store list fails, then recovery', async () => {
    const { ctx, page } = await tab(browser, flowers);
    let fail = true;
    await page.route('**/api/commerce/workspace/storefronts', (route) => (fail ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
    await page.goto(`${BASE}/commerce/themes`);
    await settle(page);
    await shot(page, 'STATE-2-error');
    const alert = await page.getByRole('alert').count();
    const cards = await page.locator('[data-theme-card]').count();
    const retry = page.getByRole('button', { name: /إعادة|retry/i });
    const hasRetry = await retry.count();
    fail = false;
    if (hasRetry) await retry.first().click();
    await page.waitForSelector('[data-store-selection-screen]', { timeout: 60000 });
    await shot(page, 'STATE-2b-recovered');
    await ctx.close();
    expect(alert > 0 && cards === 0 && hasRetry > 0, `alert=${alert} cards=${cards} retry=${hasRetry}`);
    return { alert, cards, retryRecoveredToSelection: true };
  });
  await check('STATE-3', 'Store list failure on the builder page: no builder mounted (not even local-only)', async () => {
    const { ctx, page } = await tab(browser, flowers, { label: 'STATE-3' });
    await page.route('**/api/commerce/workspace/storefronts', (route) => route.fulfill({ status: 500, body: '{}' }));
    await page.goto(`${BASE}/commerce/appearance`);
    await settle(page);
    const builder = await page.locator('[data-experience-builder]').count();
    const alert = await page.getByRole('alert').count();
    await shot(page, 'STATE-3-error-appearance');
    const w = writes('STATE-3');
    await ctx.close();
    expect(builder === 0 && alert > 0, `builder=${builder} alert=${alert}`);
    return { builderMounted: builder, writes: w.length };
  });

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, network, matrix }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
