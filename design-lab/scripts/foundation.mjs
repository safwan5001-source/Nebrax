// AWJ Unified UX Foundation — Phase 1 checks (Design Lab only).
// Usage:
//   node design-lab/scripts/foundation.mjs                 # matrix + interactions
//   node design-lab/scripts/foundation.mjs --matrix        # matrix only
//   node design-lab/scripts/foundation.mjs --interactions  # interactions only
//   node design-lab/scripts/foundation.mjs --shots [--scale=2]  # + curated screenshots (PNG → WebP via Pillow when available)
// Exit code 1 on any page error, horizontal overflow, axe (WCAG 2.x A/AA) violation or failed interaction test.
// Results are written to design-lab/foundation/checks.json.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

function loadPlaywright() {
  const webPkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/package.json');
  for (const from of [import.meta.url, webPkg]) { try { return createRequire(from)('playwright'); } catch (e) { /* next */ } }
  throw new Error('Playwright not found: run `npm ci` in web/ or install Playwright.');
}
const { chromium } = loadPlaywright();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const url = pathToFileURL(path.join(root, 'foundation', 'index.html')).href;
const axeSrc = fs.readFileSync(path.resolve(root, '../web/node_modules/axe-core/axe.min.js'), 'utf8');
const argv = process.argv.slice(2);
const only = argv.includes('--matrix') ? 'matrix' : argv.includes('--interactions') ? 'interactions' : 'all';
const shots = argv.includes('--shots');
const scale = Number((argv.find(a => a.startsWith('--scale=')) || '--scale=2').split('=')[1]);
const shotDir = path.join(root, 'foundation', 'screens');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

const ROUTES = ['home', 'kit', 'numbers', 'rules', 'sales', 'purchase', 'inventory', 'shift', 'identity'];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const out = { generated: new Date().toISOString(), matrix: [], interactions: [], summary: {} };

async function openPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.scale || 1, reducedMotion: opts.reducedMotion || 'no-preference' });
  await ctx.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_NAME|net::/.test(m.text())) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: axeSrc });
  return { ctx, page, errors };
}
const setState = (page, st) => page.evaluate((st) => {
  const F = window.__fx; F.S.overlay = null; Object.assign(F.S, st); F.render();
}, st);

/* ------------------------------------------------------------------ matrix */
async function runMatrix() {
  const configs = [];
  for (const device of ['phone', 'tablet', 'laptop']) for (const mode of ['light', 'dark']) for (const lang of ['ar', 'en']) for (const route of ROUTES) configs.push({ vp: { width: 1500, height: 1100 }, st: { route, device, mode, lang }, tag: `${device}` });
  // 2560 ultra-wide, 640 (≈200% zoom of 1280) and 320 (≈400% reflow of 1280) viewports with the frame at 100% width
  for (const [w, tag] of [[2560, 'w2560'], [640, 'zoom200'], [320, 'reflow400']]) for (const route of ROUTES) configs.push({ vp: { width: w, height: 1000 }, st: { route, device: 'wide', mode: 'light', lang: 'ar' }, tag });
  // identity packs on the four proof screens
  for (const identity of ['brass', 'fayrouz']) for (const mode of ['light', 'dark']) for (const route of ['sales', 'purchase', 'inventory', 'shift']) configs.push({ vp: { width: 1500, height: 1100 }, st: { route, device: 'laptop', mode, lang: 'ar', identity }, tag: `id-${identity}` });

  const byVp = new Map();
  for (const c of configs) { const k = c.vp.width; if (!byVp.has(k)) byVp.set(k, []); byVp.get(k).push(c); }
  for (const [, list] of byVp) {
    const { ctx, page, errors } = await openPage(list[0].vp);
    for (const c of list) {
      errors.length = 0;
      await setState(page, { identity: 'base', theme: 'default', density: 'regular', demo: 'ready', amt: 'a', ...c.st });
      await page.waitForTimeout(c.st.route === 'numbers' ? 450 : 120);
      const m = await page.evaluate(() => {
        const main = document.querySelector('#main'), app = document.querySelector('#fx-app');
        return { main: main.scrollWidth - main.clientWidth, app: app.scrollWidth - app.clientWidth, body: document.documentElement.scrollWidth - innerWidth };
      });
      const axe = await page.evaluate(async (tags) => {
        const r = await window.axe.run('#fx-app', { runOnly: { type: 'tag', values: tags }, preload: false });
        return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map(n => n.target.join(' ')) }));
      }, AXE_TAGS);
      const overflow = Math.max(m.main, m.app, m.body) > 0;
      const ok = !errors.length && !overflow && !axe.length;
      out.matrix.push({ ...c.st, vp: c.vp.width, tag: c.tag, overflow: m, axe, errors: [...errors], ok });
      if (!ok && process.env.VERBOSE) console.log('✕', c.tag, JSON.stringify(c.st), JSON.stringify(m), JSON.stringify(axe), errors.join(' | '));
    }
    await ctx.close();
  }
  const fails = out.matrix.filter(r => !r.ok).length;
  out.summary.matrix = { configs: out.matrix.length, failed: fails };
  console.log(`matrix: ${out.matrix.length - fails}/${out.matrix.length} clean`);
}

/* ------------------------------------------------------------------ interactions */
const T = [];
const test = (name, fn) => T.push({ name, fn });
const assert = (c, msg) => { if (!c) throw new Error(msg); };

async function fresh(viewport = { width: 1500, height: 1100 }, st = {}, opts = {}) {
  const env = await openPage(viewport, opts);
  await setState(env.page, { route: 'home', device: 'laptop', mode: 'light', lang: 'ar', identity: 'base', density: 'regular', demo: 'ready', amt: 'a', ...st });
  return env;
}
const vis = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);

test('Shell: navigation pattern follows the window class (bottom bar < 600 · rail 600–1199 · sidebar ≥ 1200)', async () => {
  const { ctx, page } = await fresh();
  const expect = { phone: ['.bbar', 'compact'], tablet: ['.rail', 'medium'], tabletL: ['.rail', 'medium'], laptop: ['.side', 'large'] };
  for (const [device, [sel, wc]] of Object.entries(expect)) {
    await setState(page, { device, route: 'home' }); await page.waitForTimeout(350);
    const got = { bbar: await vis(page, '.bbar'), rail: await vis(page, '.rail'), side: await vis(page, '.side'), wc: await page.evaluate(() => window.__fx.windowClass()) };
    assert(got[sel.slice(1)] && got.wc === wc, `${device}: expected ${sel}/${wc}, got ${JSON.stringify(got)}`);
    assert(['bbar', 'rail', 'side'].filter(k => got[k]).length === 1, `${device}: exactly one nav pattern must be visible ${JSON.stringify(got)}`);
  }
  await ctx.close();
});

test('Shell: rail opens a group flyout; phone menu opens the full navigation sheet', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { device: 'tablet' });
  await page.waitForTimeout(300);
  await page.click('.rail .rail-b >> nth=0');
  assert(await page.locator('#fx-app .ovl').count() === 1, 'rail group flyout did not open');
  await page.keyboard.press('Escape');
  assert(await page.locator('#fx-app .ovl').count() === 0, 'Esc did not close flyout');
  await setState(page, { device: 'phone' }); await page.waitForTimeout(300);
  await page.click('[data-act="navsheet"]');
  assert(await page.locator('#fx-app .ovl .sheet, #fx-app .ovl.bottom').count() >= 1, 'phone navigation sheet did not open');
  await ctx.close();
});

test('Command palette: Ctrl K opens, scope prefixes (c/ع customers · p/م products · > actions), Enter runs, Esc closes', async () => {
  const { ctx, page } = await fresh();
  await page.keyboard.press('Control+k');
  assert(await page.locator('#pal-q').count() === 1, 'palette not open');
  assert(await page.evaluate(() => document.activeElement.id) === 'pal-q', 'palette input not focused');
  for (const [q, g] of [['ع ', 'cmdCust'], ['c ', 'cmdCust'], ['م ', 'cmdProd'], ['> ', 'cmdAct']]) {
    await page.fill('#pal-q', q); await page.waitForTimeout(80);
    const scope = await page.locator('.pal .scope').count();
    assert(scope === 1, `prefix "${q}" did not set a scope`);
  }
  await page.fill('#pal-q', '> '); await page.waitForTimeout(80);
  const n = await page.locator('.pal [role="option"]').count();
  assert(n > 0, 'no action results');
  await page.keyboard.press('Escape');
  assert(await page.locator('.pal').count() === 0, 'Esc did not close palette');
  await ctx.close();
});

test('Keyboard: G then S/P/I/F navigates; ? opens the shortcut sheet', async () => {
  const { ctx, page } = await fresh();
  for (const [k, r] of [['s', 'sales'], ['p', 'purchase'], ['i', 'inventory'], ['f', 'shift']]) {
    await page.locator('#main').focus(); await page.keyboard.press('g'); await page.keyboard.press(k);
    assert(await page.evaluate(() => window.__fx.S.route) === r, `G ${k} → expected ${r}`);
  }
  await page.locator('#main').focus(); await page.keyboard.press('Shift+Slash');
  assert(await page.locator('#fx-app .dlg').count() === 1, '? did not open shortcuts');
  await ctx.close();
});

test('Sales invoice: totals are integer halalas derived from lines; editing a line recomputes them', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  const r = await page.evaluate(() => { const F = window.__fx; const t = F.totals(F.S.docs.sales.lines); return { t, ints: Object.values(t).every(Number.isInteger), sum: t.net + t.vat === t.total }; });
  assert(r.ints && r.sum, 'totals not integer / net+vat≠total ' + JSON.stringify(r));
  const id = await page.evaluate(() => window.__fx.S.docs.sales.lines[0].id);
  await page.fill(`#sales-l${id}-qty`, '2.5'); await page.waitForTimeout(150);
  const after = await page.evaluate(() => { const F = window.__fx; const l = F.S.docs.sales.lines[0]; return { qtyM: l.qtyM, total: F.totals(F.S.docs.sales.lines).total, dirty: F.S.docs.sales.dirty, dom: document.querySelector('.dock [data-tot="total"]').textContent }; });
  assert(after.qtyM === 2500 && Number.isInteger(after.total) && after.dirty, 'line edit not applied ' + JSON.stringify(after));
  const fmt = (after.total / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  assert(after.dom.replace(/[^\d.,]/g, '').includes(fmt), `outcome ${after.dom} does not show ${fmt}`);
  await ctx.close();
});

test('Arabic-Indic digits are normalised in amount inputs (٢٫٥ → 2.5)', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  const id = await page.evaluate(() => window.__fx.S.docs.sales.lines[0].id);
  await page.fill(`#sales-l${id}-qty`, '٢٫٥'); await page.waitForTimeout(150);
  assert(await page.evaluate(() => window.__fx.S.docs.sales.lines[0].qtyM) === 2500, 'Arabic-Indic qty not parsed');
  await ctx.close();
});

for (const [kind, accs] of [['sales', ['1130', '4110', '2120']], ['purchase', ['1140', '1150', '2110']]]) {
  test(`${kind} invoice: Ctrl Enter shows a balanced illustrative entry (${accs.join(' / ')}) that equals the document total`, async () => {
    const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: kind });
    if (kind === 'purchase') { await page.fill('#purchase-ref', 'SUP-88412'); await page.waitForTimeout(80); }
    await page.locator('#main').focus(); await page.keyboard.press('Control+Enter');
    if (await page.locator('.err-summary').count()) throw new Error('sample document has validation errors: ' + await page.locator('.err-summary').innerText());
    const je = await page.evaluate((k) => { const dr = Number(document.querySelector('[data-dr]').dataset.dr), cr = Number(document.querySelector('[data-cr]').dataset.cr); const F = window.__fx; return { dr, cr, total: F.totals(F.S.docs[k].lines).total, accs: [...document.querySelectorAll('.je .acc')].map(e => e.textContent) }; }, kind);
    assert(je.dr === je.cr && je.dr === je.total, 'unbalanced ' + JSON.stringify(je));
    assert(JSON.stringify(je.accs) === JSON.stringify(accs), 'accounts ' + JSON.stringify(je.accs));
    assert(await page.evaluate(() => document.querySelector('.dlg').contains(document.activeElement)), 'focus not inside dialog');
    await ctx.close();
  });
}

test('Validation: missing party blocks posting with a focused error summary that links to the field', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  await page.evaluate(() => { const F = window.__fx; F.S.docs.sales.party = null; F.render(); });
  await page.click('.cmdbar [data-act="post"]');
  assert(await page.locator('.err-summary').count() === 1, 'no error summary');
  assert(await page.evaluate(() => document.activeElement?.id) === 'sales-sum', 'summary not focused');
  await page.click('.err-summary [data-focus]');
  assert(await page.evaluate(() => document.activeElement?.id) === 'sales-party', 'summary link did not focus the field');
  assert(await page.locator('.dlg').count() === 0, 'post dialog opened despite errors');
  await ctx.close();
});

test('Line product change keeps keyboard focus on that line\'s product selector (no selector error)', async () => {
  const { ctx, page, errors } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  const id = await page.evaluate(() => window.__fx.S.docs.sales.lines[0].id);
  await page.focus(`#sales-l${id}-p`);
  await page.selectOption(`#sales-l${id}-p`, { index: 2 }); await page.waitForTimeout(120);
  assert(!errors.length, 'page error: ' + errors.join(' | '));
  assert(await page.evaluate(() => document.activeElement?.id) === `sales-l${id}-p`, 'focus lost after product change');
  await ctx.close();
});

test('An invoice with no billable lines cannot be posted; the summary links to Add line', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  while (await page.locator('[data-del]').count()) await page.click('[data-del] >> nth=0');
  await page.click('.cmdbar [data-act="post"]');
  assert(await page.locator('.dlg').count() === 0, 'journal preview opened with no lines');
  assert(await page.locator('.err-summary').count() === 1, 'no error summary');
  await page.click('.err-summary [data-focus="#sales-addline"]');
  assert(await page.evaluate(() => document.activeElement?.id) === 'sales-addline', 'summary link did not focus Add line');
  await page.click('#sales-addline'); await page.waitForTimeout(100);
  await page.locator('#main').focus(); await page.keyboard.press('Control+Enter');
  assert(await page.locator('.dlg [data-dr]').count() === 1, 'one billable line should allow the preview');
  await ctx.close();
});

test('After a failed posting attempt, typing 1.5 keeps the decimal point (qty 1500, not 15000)', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  await page.evaluate(() => { const F = window.__fx; F.S.docs.sales.party = null; F.render(); });
  await page.click('.cmdbar [data-act="post"]');
  assert(await page.evaluate(() => window.__fx.S.docs.sales.showErrs), 'showErrs not set');
  const id = await page.evaluate(() => window.__fx.S.docs.sales.lines[0].id);
  await page.fill(`#sales-l${id}-qty`, ''); await page.type(`#sales-l${id}-qty`, '1.5', { delay: 30 });
  assert(await page.inputValue(`#sales-l${id}-qty`) === '1.5', 'input shows ' + await page.inputValue(`#sales-l${id}-qty`));
  assert(await page.evaluate(() => window.__fx.S.docs.sales.lines[0].qtyM) === 1500, 'qty stored as ' + await page.evaluate(() => window.__fx.S.docs.sales.lines[0].qtyM));
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => window.__fx.S.docs.sales.lines[0].raw?.qty) === undefined, 'raw text kept after leaving the field');
  await ctx.close();
});

test('Leave without saving discards only the edits after the last saved draft', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'purchase' });
  await page.fill('#purchase-ref', 'SAVED-REF');
  await page.locator('#main').focus(); await page.keyboard.press('Control+s'); await page.waitForTimeout(80);
  await page.fill('#purchase-ref', 'UNSAVED-REF');
  await page.click('.side [data-route="inventory"]'); await page.click('.dlg [data-act="leave-go"]');
  await page.click('.side [data-route="purchase"]'); await page.waitForTimeout(80);
  assert(await page.inputValue('#purchase-ref') === 'SAVED-REF', 'ref after discard = ' + await page.inputValue('#purchase-ref'));
  assert(await page.evaluate(() => window.__fx.S.docs.purchase.dirty) === false, 'restored draft is dirty');
  await ctx.close();
});

test('Closing a dialog returns focus to a connected control (More → Delete draft → Cancel / Esc; kit confirm)', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  const more = '.cmdbar [data-act="menu"][data-menu="doc"]';
  for (const how of ['cancel', 'escape']) {
    await page.click(more); await page.click('.menu [data-act="confirm-delete"]');
    assert(await page.locator('.dlg').count() === 1, 'confirm not open');
    if (how === 'cancel') await page.click('.dlg [data-act="close"]'); else await page.keyboard.press('Escape');
    const f = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), more);
    assert(f, `${how}: focus is on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`);
  }
  await setState(page, { route: 'kit' });
  const btn = page.locator('[data-act="confirm-delete"]').nth(0);
  await btn.click(); await page.click('.dlg [data-act="close"]');
  assert(await page.evaluate(() => document.activeElement === document.querySelectorAll('[data-act="confirm-delete"]')[0]), 'kit: focus not returned to the trigger');
  await ctx.close();
});

test('Changing a line\'s product clears a stale invalid price so display, totals and validation agree', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  const id = await page.evaluate(() => window.__fx.S.docs.sales.lines[0].id);
  await page.fill(`#sales-l${id}-price`, 'abc'); await page.waitForTimeout(80);
  assert(await page.getAttribute(`#sales-l${id}-price`, 'aria-invalid') === 'true', 'abc not flagged');
  await page.selectOption(`#sales-l${id}-p`, { index: 2 }); await page.waitForTimeout(120);
  const r = await page.evaluate((id) => { const l = window.__fx.S.docs.sales.lines[0]; return { shown: document.querySelector(`#sales-l${id}-price`).value, invalid: document.querySelector(`#sales-l${id}-price`).getAttribute('aria-invalid'), price: l.price }; }, id);
  assert(r.invalid === null && r.shown !== 'abc' && Math.round(Number(r.shown) * 100) === r.price, 'stale price state ' + JSON.stringify(r));
  await page.locator('#main').focus(); await page.keyboard.press('Control+Enter');
  assert(await page.locator('.dlg [data-dr]').count() === 1, 'posting still blocked by the obsolete price error');
  await ctx.close();
});

test('Inventory: Enter on a focused button keeps its own action; Enter elsewhere opens the active row', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'inventory' });
  await page.locator('#main').focus(); await page.keyboard.press('j');
  const chip = page.locator('#fx-app [data-ist]').nth(1);
  const st = await chip.getAttribute('data-ist');
  await chip.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
  assert(await page.evaluate(() => window.__fx.S.inv.st) === st, 'Enter on the filter chip did not apply it');
  assert(await page.evaluate(() => window.__fx.S.inv.peek) === null, 'Enter on a chip opened the peek instead');
  await page.locator('#main').focus(); await page.keyboard.press('j'); await page.keyboard.press('Enter');
  assert(await page.locator('.split.peeking .peek').count() === 1, 'Enter on the list did not open the active row');
  await ctx.close();
});

test('Compact screens: Save draft is reachable from the More menu (no keyboard needed)', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales', device: 'phone' });
  await page.waitForTimeout(300);
  const id = await page.evaluate(() => window.__fx.S.docs.sales.lines[0].id);
  await page.fill(`#sales-l${id}-disc`, '5'); await page.waitForTimeout(80);
  assert(await page.evaluate(() => window.__fx.S.docs.sales.dirty), 'not dirty');
  assert(!(await vis(page, '.cmdbar [data-act="save-draft"]:not([role="menuitem"])')), 'toolbar save unexpectedly visible on compact');
  await page.click('.cmdbar [data-act="menu"]');
  await page.click('.menu [data-act="save-draft"]');
  assert(await page.evaluate(() => window.__fx.S.docs.sales.dirty) === false, 'menu Save draft did not save');
  assert(await page.locator('.menu').count() === 0, 'menu still open');
  assert(await page.evaluate(() => document.activeElement?.matches('.cmdbar [data-act="menu"]')), 'focus not returned to More');
  await ctx.close();
});

test('Locked period: a date before 2026-10-01 shows the warning and disables posting', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  await page.fill('#sales-date', '2026-09-15'); await page.locator('#sales-date').dispatchEvent('change'); await page.waitForTimeout(150);
  assert(await page.locator('#sales-lock').count() === 1, 'locked-period message missing');
  assert(await page.getAttribute('.cmdbar [data-act="post"]', 'aria-disabled') === 'true', 'post not aria-disabled');
  await page.click('.cmdbar [data-act="post"]', { force: true }); // aria-disabled (still focusable, explains why) — the click must be a no-op
  await page.locator('#main').focus(); await page.keyboard.press('Control+Enter');
  assert(await page.locator('.dlg').count() === 0, 'post dialog opened in a locked period');
  await ctx.close();
});

test('Unsaved changes: leaving a dirty document asks first; Stay keeps it, Leave navigates; Ctrl S clears the flag', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  const id = await page.evaluate(() => window.__fx.S.docs.sales.lines[0].id);
  await page.fill(`#sales-l${id}-disc`, '10'); await page.waitForTimeout(120);
  await page.click('.side [data-route="inventory"]');
  assert(await page.locator('.dlg').count() === 1 && await page.evaluate(() => window.__fx.S.route) === 'sales', 'guard did not stop navigation');
  await page.click('.dlg [data-act="close"]');
  assert(await page.evaluate(() => window.__fx.S.route) === 'sales', 'Stay did not keep the document');
  await page.locator('#main').focus(); await page.keyboard.press('Control+s'); await page.waitForTimeout(80);
  assert(await page.evaluate(() => window.__fx.S.docs.sales.dirty) === false, 'Ctrl S did not save');
  await page.fill(`#sales-l${id}-disc`, '20'); await page.waitForTimeout(120);
  await page.click('.side [data-route="inventory"]'); await page.click('.dlg [data-act="leave-go"]');
  assert(await page.evaluate(() => window.__fx.S.route) === 'inventory', 'Leave did not navigate');
  await ctx.close();
});

test('Inventory: peek is a split pane at ≥ 1200 and a sheet below; J/K move the active row', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'inventory' });
  await page.click('table.dt [data-peek] >> nth=0');
  assert(await page.locator('.split.peeking .peek').count() === 1, 'split peek not shown at laptop');
  await page.click('[data-act="peek-close"]');
  await setState(page, { device: 'tablet' }); await page.waitForTimeout(350);
  await page.click('table.dt [data-peek] >> nth=0');
  assert(await page.locator('#fx-app .ovl').count() === 1, 'peek sheet not shown at tablet');
  await page.keyboard.press('Escape');
  await setState(page, { device: 'laptop' }); await page.waitForTimeout(350);
  await page.locator('#main').focus(); await page.keyboard.press('j'); await page.keyboard.press('j');
  const a = await page.evaluate(() => window.__fx.S.inv.active);
  await page.keyboard.press('k');
  const b = await page.evaluate(() => window.__fx.S.inv.active);
  assert(a && b && a !== b, `J/K did not move (${a} → ${b})`);
  await ctx.close();
});

test('Inventory: removing the cost permission removes cost columns and values from the page (not hidden)', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'inventory' });
  const count = () => page.evaluate(() => document.querySelectorAll('#fx-app table.dt .m').length);
  const before = await count();
  await page.click('input[data-act="cost-perm"]'); await page.waitForTimeout(100);
  const after = await count();
  const hidden = await page.evaluate(() => [...document.querySelectorAll('#fx-app *')].filter(e => getComputedStyle(e).display === 'none' && e.querySelector?.('.m')).length);
  assert(before > 0 && after === 0, `money cells ${before} → ${after}`);
  assert(hidden === 0, 'cost values exist in hidden DOM');
  await ctx.close();
});

test('Field contract: validate on blur, summary on submit, success clears the form', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'kit' });
  await page.focus('#kf-name'); await page.focus('#kf-vat');
  assert(await page.getAttribute('#kf-name', 'aria-invalid') === 'true', 'name not invalid after blur');
  assert(await page.evaluate(() => document.activeElement?.id) === 'kf-vat', 'focus lost after blur validation');
  await page.click('#kform [type="submit"]');
  assert(await page.evaluate(() => document.activeElement?.id) === 'kf-sum', 'summary not focused on submit');
  await page.fill('#kf-name', 'مؤسسة الاختبار'); await page.fill('#kf-vat', '300000000000003');
  await page.click('#kform [type="submit"]'); await page.waitForTimeout(900);
  assert(await page.inputValue('#kf-name') === '', 'form not reset after success');
  assert(await page.locator('#toasts .toast').count() >= 1, 'no success toast');
  await ctx.close();
});

test('Dialog: focus is trapped inside a destructive confirm; Esc closes', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'kit' });
  await page.click('[data-act="confirm-delete"] >> nth=0');
  assert(await page.locator('.dlg').count() === 1, 'confirm not open');
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.querySelector('.dlg').contains(document.activeElement)), 'focus escaped on Tab ' + i); }
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Tab'); assert(await page.evaluate(() => document.querySelector('.dlg').contains(document.activeElement)), 'focus escaped on Shift+Tab ' + i); }
  await page.keyboard.press('Escape');
  assert(await page.locator('.dlg').count() === 0, 'Esc did not close');
  await ctx.close();
});

test('States: loading → skeleton, empty → empty state with action, error → retry', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'kit' });
  await setState(page, { demo: 'loading' }); assert(await page.locator('#fx-app .sk').count() > 0, 'no skeleton');
  await setState(page, { demo: 'empty' }); assert(await page.locator('#fx-app .state').count() > 0, 'no empty state');
  await setState(page, { demo: 'error' }); assert(await page.locator('#fx-app [data-act="retry"]').count() >= 1, 'no retry');
  await ctx.close();
});

test('Density: compact rows are shorter than regular; Floor posture keeps touch targets ≥ 44px', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'kit' });
  const rowH = () => page.evaluate(() => document.querySelector('#fx-app table.dt tbody tr').getBoundingClientRect().height);
  const reg = await rowH(); await setState(page, { density: 'compact' }); const cmp = await rowH();
  assert(cmp < reg, `compact ${cmp} !< regular ${reg}`);
  await setState(page, { route: 'shift', density: 'regular', device: 'phone' }); await page.waitForTimeout(350);
  const small = await page.evaluate(() => [...document.querySelectorAll('#main button, #main input')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height < 44; }).map(e => e.outerHTML.slice(0, 60)));
  assert(!small.length, 'targets < 44px on Floor: ' + small.join(' | '));
  await ctx.close();
});

test('Shift: a closing reading below the opening meter is flagged and blocks saving', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'shift' });
  const first = await page.getAttribute('[data-reading] >> nth=0', 'data-reading');
  await page.fill(`[data-reading="${first}"]`, '1'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ ok: !!document.querySelector('[data-act="save-readings"]:not([disabled])'), invalid: !!document.querySelector('[data-reading][aria-invalid="true"]') }));
  assert(r.invalid && !r.ok, 'below-opening reading not flagged ' + JSON.stringify(r));
  await ctx.close();
});

test('M2 comparison: A (text-end) misaligns decimals in RTL; B aligns with tabular figures; C aligns always — RTL/LTR, negatives, riyal sign', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'numbers' });
  const res = {};
  for (const font of ['mono', 'sans', 'prop']) for (const neg of [true, false]) for (const sym of [true, false]) {
    const m = await page.evaluate(([font, neg, sym]) => { const F = window.__fx; Object.assign(F.S.num, { font, neg, sym }); F.render(); return F.measureNumbers(); }, [font, neg, sym]);
    res[`${font}/${neg ? 'neg' : 'pos'}/${sym ? 'sym' : 'nosym'}`] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.spread]));
    if (font !== 'prop') {
      assert(!m['rtl-a'].pass, `A should fail in RTL (${font}, neg=${neg}, sym=${sym}) spread=${m['rtl-a'].spread}`);
      for (const k of ['rtl-b', 'ltr-b', 'rtl-c', 'ltr-c', 'ltr-a']) assert(m[k].pass, `${k} should pass (${font}, neg=${neg}, sym=${sym}) spread=${m[k].spread}`);
    } else {
      // proportional figures: physical right alignment (B) can no longer line decimals up; only the split columns (C) can
      for (const k of ['rtl-c', 'ltr-c']) assert(m[k].pass, `${k} should pass with proportional figures, spread=${m[k].spread}`);
      assert(!m['rtl-b'].pass && !m['ltr-b'].pass, `B should fail with proportional figures (rtl ${m['rtl-b'].spread}, ltr ${m['ltr-b'].spread})`);
    }
  }
  out.m2 = res;
  await ctx.close();
});

test('Identity contract: v3 base, brass and fayrouz are accepted; the invalid pack is rejected (locked token + contrast)', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'identity' });
  const r = await page.evaluate(() => Object.fromEntries(['base', 'brass', 'fayrouz', 'invalid'].map(id => [id, window.__fx.contract(id)])));
  out.contract = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { accepted: v.accepted, allowedChanged: v.allowedChanged, lockedChanged: v.lockedChanged, failing: Object.fromEntries(Object.entries(v.modes).map(([m, cs]) => [m, cs.filter(c => !c.pass).map(c => `${c.name} ${c.r}`)])) }]));
  for (const id of ['base', 'brass', 'fayrouz']) assert(r[id].accepted, `${id} rejected: ${JSON.stringify(out.contract[id])}`);
  assert(!r.invalid.accepted && r.invalid.lockedChanged.length > 0, 'invalid pack accepted');
  assert(Object.values(out.contract.invalid.failing).some(f => f.length), 'invalid pack has no contrast failure');
  assert(r.brass.allowedChanged > 0 && r.fayrouz.allowedChanged > 0, 'packs changed nothing');
  await ctx.close();
});

test('Direction: directional icons mirror in RTL only; amounts stay LTR-isolated in both', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'sales' });
  const probe = () => page.evaluate(() => ({ t: getComputedStyle(document.querySelector('#fx-app .dir-icon')).transform, money: getComputedStyle(document.querySelector('#fx-app .m')).direction, nonDir: getComputedStyle(document.querySelector('#fx-app svg:not(.dir-icon)')).transform }));
  const ar = await probe(); await setState(page, { lang: 'en' }); const en = await probe();
  assert(ar.t.startsWith('matrix(-1'), 'RTL dir-icon not mirrored ' + ar.t);
  assert(en.t === 'none', 'LTR dir-icon mirrored ' + en.t);
  assert(ar.nonDir === 'none', 'non-directional icon mirrored');
  assert(ar.money === 'ltr' && en.money === 'ltr', 'money not LTR-isolated');
  await ctx.close();
});

test('Reduced motion: transitions and animations are disabled inside the frame', async () => {
  const { ctx, page } = await fresh({ width: 1500, height: 1100 }, { route: 'kit' }, { reducedMotion: 'reduce' });
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('#fx-app .btn')).transitionDuration);
  assert(/^0s(, 0s)*$/.test(d), 'transition still ' + d);
  await ctx.close();
});

async function runInteractions() {
  for (const t of T) {
    try { await t.fn(); out.interactions.push({ name: t.name, ok: true }); console.log('✓', t.name); }
    catch (e) { out.interactions.push({ name: t.name, ok: false, error: String(e.message || e) }); console.log('✕', t.name, '\n   ', String(e.message || e)); }
  }
  const failed = out.interactions.filter(r => !r.ok).length;
  out.summary.interactions = { tests: T.length, failed };
  console.log(`interactions: ${T.length - failed}/${T.length} passed`);
}

/* ------------------------------------------------------------------ screenshots */
async function runShots() {
  fs.mkdirSync(shotDir, { recursive: true });
  const list = [];
  for (const r of ROUTES) list.push([`${r}-laptop`, { route: r, device: 'laptop' }]);
  for (const r of ['home', 'numbers', 'sales', 'purchase', 'inventory', 'shift']) list.push([`${r}-phone`, { route: r, device: 'phone' }]);
  for (const r of ['sales', 'inventory', 'shift']) list.push([`${r}-tablet`, { route: r, device: 'tablet' }]);
  for (const r of ['sales', 'inventory', 'shift']) list.push([`${r}-laptop-dark`, { route: r, device: 'laptop', mode: 'dark' }]);
  for (const r of ['sales', 'numbers']) list.push([`${r}-laptop-ltr`, { route: r, device: 'laptop', lang: 'en' }]);
  list.push(['sales-laptop-amtB', { route: 'sales', device: 'laptop', amt: 'b' }]);
  list.push(['sales-laptop-brass', { route: 'sales', device: 'laptop', identity: 'brass' }]);
  list.push(['inventory-laptop-fayrouz-dark', { route: 'inventory', device: 'laptop', identity: 'fayrouz', mode: 'dark' }]);
  list.push(['identity-laptop-invalid', { route: 'identity', device: 'laptop', identity: 'invalid' }]);
  const { ctx, page } = await openPage({ width: 1500, height: 1100 }, { scale });
  for (const [name, st] of list) {
    await setState(page, { mode: 'light', lang: 'ar', identity: 'base', amt: 'a', density: 'regular', demo: 'ready', ...st });
    if (st.route === 'inventory' && st.device === 'laptop') await page.evaluate(() => { const F = window.__fx; F.S.inv.peek = 'CBL-3X25'; F.S.inv.active = 'CBL-3X25'; F.render(); });
    await page.waitForTimeout(st.route === 'numbers' ? 600 : 250);
    const png = path.join(shotDir, name + '.png');
    await page.locator('.stage-wrap').screenshot({ path: png });
  }
  const wide = await openPage({ width: 2560, height: 1300 }, { scale: 1 });
  await setState(wide.page, { route: 'inventory', device: 'wide', mode: 'light', lang: 'ar' });
  await wide.page.evaluate(() => { const F = window.__fx; F.S.inv.peek = 'CBL-3X25'; F.render(); });
  await wide.page.waitForTimeout(300);
  await wide.page.locator('.stage-wrap').screenshot({ path: path.join(shotDir, 'inventory-2560.png') });
  await wide.ctx.close(); await ctx.close();
  try {
    execFileSync('python3', ['-c', `import sys,glob,os
from PIL import Image
for p in glob.glob(os.path.join(sys.argv[1],'*.png')):
    Image.open(p).save(p[:-4]+'.webp','WEBP',quality=80,method=6); os.remove(p)`, shotDir]);
    console.log(`shots: ${list.length + 1} → WebP in ${path.relative(process.cwd(), shotDir)}`);
  } catch (e) { console.log(`shots: ${list.length + 1} PNG (Pillow unavailable, not converted)`); }
}

if (only !== 'interactions') await runMatrix();
if (only !== 'matrix') await runInteractions();
if (shots) await runShots();
await browser.close();
const prev = fs.existsSync(path.join(root, 'foundation', 'checks.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'foundation', 'checks.json'), 'utf8')) : {};
const merged = { ...prev, ...out, matrix: out.matrix.length ? out.matrix : prev.matrix || [], interactions: out.interactions.length ? out.interactions : prev.interactions || [], summary: { ...(prev.summary || {}), ...out.summary } };
fs.writeFileSync(path.join(root, 'foundation', 'checks.json'), JSON.stringify(merged, null, 1));
const bad = (out.summary.matrix?.failed || 0) + (out.summary.interactions?.failed || 0);
process.exit(bad ? 1 : 0);
