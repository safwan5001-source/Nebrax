// AWJ Signature V3 — visual + functional checks for the two identities (Design Lab only).
// Usage:
//   node design-lab/scripts/signature.mjs                 # matrix + interactions
//   node design-lab/scripts/signature.mjs --matrix | --interactions
//   node design-lab/scripts/signature.mjs --shots [--scale=2]   # all 39 2× screenshots → design-lab/signature/out/screens (git-ignored test output)
//   node design-lab/scripts/signature.mjs --previews            # the 8 committed key previews → design-lab/signature/previews
// Exit 1 on any page error, horizontal overflow, axe (WCAG 2.x A/AA) violation, clipped/wrapped amount,
// overlapping controls, decimal misalignment or failed interaction test. Results: design-lab/signature/checks.json
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
const base = pathToFileURL(path.join(root, 'signature', 'index.html')).href;
const axeSrc = fs.readFileSync(path.resolve(root, '../web/node_modules/axe-core/axe.min.js'), 'utf8');
const argv = process.argv.slice(2);
const only = argv.includes('--matrix') ? 'matrix' : argv.includes('--interactions') ? 'interactions' : 'all';
const previews = argv.includes('--previews'), shots = argv.includes('--shots') || previews;
const scale = Number((argv.find(a => a.startsWith('--scale=')) || '--scale=2').split('=')[1]);
const shotDir = previews ? path.join(root, 'signature', 'previews') : path.join(root, 'signature', 'out', 'screens');
const PREVIEWS = ['nasaq-dashboard-1366', 'liwan-dashboard-1366', 'nasaq-dashboard-390', 'liwan-dashboard-390', 'nasaq-sales-1366-errors', 'liwan-sales-1366-errors', 'liwan-dashboard-2560'];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const IDS = ['nasaq', 'liwan'];
const ROUTES = ['dashboard', 'sales', 'purchase', 'inventory', 'shift'];
const WIDTHS = [[320, 640], [390, 844], [430, 932], [683, 768], [768, 1024], [834, 1194], [1366, 768], [1920, 1080], [2560, 1080]];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const out = { generated: new Date().toISOString(), matrix: [], interactions: [], summary: {} };

async function open(qs, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.scale || 1, reducedMotion: opts.reducedMotion || 'no-preference' });
  if (!opts.keepStorage) await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('__keep')) localStorage.clear(); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_NAME|net::/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}?${qs}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: axeSrc });
  return { ctx, page, errors };
}
const setState = (page, st) => page.evaluate((st) => { const F = window.__fx; F.S.overlay = null; Object.assign(F.S, st); F.render(); }, st);

/** Layout quality probes run inside the page. */
const PROBES = () => {
  const app = document.querySelector('#fx-app'), main = document.querySelector('#main'), res = { clippedAmounts: [], wrappedAmounts: [], overlaps: [], decimal: [] };
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.closest('[hidden],details:not([open]) > :not(summary)'); };
  // amounts: one line, not clipped by an overflow ancestor
  app.querySelectorAll('.m').forEach(m => {
    if (!vis(m)) return; const r = m.getBoundingClientRect(), lh = parseFloat(getComputedStyle(m).fontSize) * 1.7;
    if (r.height > lh) res.wrappedAmounts.push(m.closest('[class]')?.className + ' :: ' + m.textContent);
    let p = m.parentElement; while (p && p !== app) { const s = getComputedStyle(p); if (/(hidden|clip)/.test(s.overflowX) && !/(auto|scroll)/.test(s.overflowX)) { const pr = p.getBoundingClientRect(); if (r.left < pr.left - 1 || r.right > pr.right + 1) { res.clippedAmounts.push(p.className + ' :: ' + m.textContent); break; } } p = p.parentElement; }
  });
  // overlapping controls (visible buttons/inputs inside the shell)
  // visible rect = element rect clipped by every scrolling/clipping ancestor; sticky/fixed bars float over scrolled content by design and are excluded
  const clipRect = (e) => { let r = e.getBoundingClientRect(), x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom; let p = e.parentElement; while (p && p !== app) { const s = getComputedStyle(p); if (s.position === 'sticky' || s.position === 'fixed') return null; if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const q = p.getBoundingClientRect(); x1 = Math.max(x1, q.left); y1 = Math.max(y1, q.top); x2 = Math.min(x2, q.right); y2 = Math.min(y2, q.bottom); } p = p.parentElement; } return x2 - x1 > 1 && y2 - y1 > 1 ? { left: x1, top: y1, right: x2, bottom: y2 } : null; };
  const ctl = [...app.querySelectorAll('.fx-shell button, .fx-shell input:not([type=checkbox]), .fx-shell select')].filter(vis).map(e => [e, clipRect(e)]).filter(([, r]) => r);
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const [a, ra] = ctl[i], [b, rb] = ctl[j]; if (a.contains(b) || b.contains(a)) continue;
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 2 && oy > 2) { res.overlaps.push(`${a.className || a.tagName}|${(a.textContent || '').trim().slice(0, 20)} × ${b.className || b.tagName}|${(b.textContent || '').trim().slice(0, 20)}`); if (res.overlaps.length > 4) break; }
  }
  // decimal alignment per table column (D1: physical right + tabular figures)
  main.querySelectorAll('table').forEach(tb => {
    if (!vis(tb) || getComputedStyle(tb).display !== 'table') return;
    const cols = {};
    tb.querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, ci) => {
      if (!td.classList.contains('c-amt') || !vis(td)) return;
      const fr = td.querySelector('.m .fr'); let x = null;
      if (fr) { const rg = document.createRange(); rg.setStart(fr.firstChild, 0); rg.setEnd(fr.firstChild, 1); x = rg.getBoundingClientRect().left; }
      else if (td.classList.contains('ro')) { const tn = [...td.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.includes('.')); if (tn) { const i = tn.textContent.lastIndexOf('.'); const rg = document.createRange(); rg.setStart(tn, i); rg.setEnd(tn, i + 1); x = rg.getBoundingClientRect().left; } }
      if (x !== null) (cols[ci] = cols[ci] || []).push(x);
    }));
    Object.entries(cols).forEach(([ci, xs]) => { if (xs.length < 2) return; const sp = Math.max(...xs) - Math.min(...xs); if (sp > 0.75) res.decimal.push(`${tb.className} col ${ci}: ${sp.toFixed(1)}px`); });
  });
  return res;
};

/* ------------------------------------------------------------------ matrix */
async function runMatrix() {
  for (const [w, h] of WIDTHS) {
    const { ctx, page, errors } = await open('embed=1', { width: w, height: h });
    for (const identity of IDS) for (const route of ROUTES) for (const mode of ['light', 'dark']) for (const lang of ['ar', 'en']) {
      errors.length = 0;
      await setState(page, { identity, route, mode, lang, density: 'regular', demo: 'ready' });
      await page.waitForTimeout(80);
      const ov = await page.evaluate(() => { const m = document.querySelector('#main'), a = document.querySelector('#fx-app'); return { main: m.scrollWidth - m.clientWidth, app: a.scrollWidth - a.clientWidth, body: document.documentElement.scrollWidth - innerWidth }; });
      const q = await page.evaluate(PROBES);
      const axe = await page.evaluate(async (tags) => (await window.axe.run('#fx-app', { runOnly: { type: 'tag', values: tags }, preload: false })).violations.map(v => ({ id: v.id, n: v.nodes.length, sample: v.nodes.slice(0, 2).map(n => n.target.join(' ')) })), AXE_TAGS);
      const bad = errors.length || Math.max(ov.main, ov.app, ov.body) > 0 || axe.length || q.clippedAmounts.length || q.wrappedAmounts.length || q.overlaps.length || q.decimal.length;
      out.matrix.push({ identity, route, mode, lang, w, overflow: ov, axe, errors: [...errors], ...q, ok: !bad });
      if (bad && process.env.VERBOSE) console.log('✕', w, identity, route, mode, lang, JSON.stringify({ ov, axe, errors, ...q }).slice(0, 500));
    }
    await ctx.close();
  }
  // density compact on the four proof screens
  const { ctx, page, errors } = await open('embed=1', { width: 1366, height: 768 });
  for (const identity of IDS) for (const route of ROUTES) {
    errors.length = 0; await setState(page, { identity, route, mode: 'light', lang: 'ar', density: 'compact' }); await page.waitForTimeout(80);
    const q = await page.evaluate(PROBES); const axe = await page.evaluate(async (tags) => (await window.axe.run('#fx-app', { runOnly: { type: 'tag', values: tags }, preload: false })).violations.map(v => v.id), AXE_TAGS);
    const ok = !errors.length && !axe.length && !q.clippedAmounts.length && !q.wrappedAmounts.length && !q.overlaps.length && !q.decimal.length;
    out.matrix.push({ identity, route, mode: 'light', lang: 'ar', w: 1366, density: 'compact', axe, errors: [...errors], ...q, ok });
  }
  await ctx.close();
  const failed = out.matrix.filter(r => !r.ok);
  out.summary.matrix = { configs: out.matrix.length, failed: failed.length };
  const groups = {}; failed.forEach(r => { const k = [r.errors.length && 'error', r.axe?.length && 'axe:' + (r.axe.map(a => a.id || a).join(',')), r.clippedAmounts?.length && 'clipped', r.wrappedAmounts?.length && 'wrapped', r.overlaps?.length && 'overlap', r.decimal?.length && 'decimal', r.overflow && Math.max(r.overflow.main, r.overflow.app, r.overflow.body) > 0 && 'overflow'].filter(Boolean).join('+'); (groups[k] = groups[k] || []).push(`${r.w}/${r.identity}/${r.route}/${r.mode}/${r.lang}`); });
  Object.entries(groups).forEach(([k, v]) => console.log(`  ✕ ${k} ×${v.length}: ${v.slice(0, 6).join(' ')}`));
  console.log(`matrix: ${out.matrix.length - failed.length}/${out.matrix.length} clean`);
}

/* ------------------------------------------------------------------ interactions */
const T = []; const test = (name, fn) => T.push({ name, fn });
const assert = (c, m) => { if (!c) throw new Error(m); };

test('Same markup, different identity: every proof screen renders identical DOM in Nasaq and Liwan', async () => {
  const { ctx, page } = await open('embed=1', { width: 1366, height: 768 });
  for (const route of ROUTES) for (const lang of ['ar', 'en']) {
    const html = {};
    for (const identity of IDS) { await setState(page, { identity, route, lang }); html[identity] = await page.evaluate(() => document.querySelector('.fx-shell').innerHTML.replace(/\s+/g, ' ')); }
    assert(html.nasaq === html.liwan, `${route}/${lang}: markup differs between identities`);
    const ids = await page.evaluate(() => document.querySelector('#fx-app').dataset.identity);
    assert(ids === 'liwan', 'identity attribute not applied');
  }
  await ctx.close();
});

test('Contract: Nasaq and Liwan are accepted in light and dark; v3, brass, fayrouz stay accepted; invalid stays rejected', async () => {
  const { ctx, page } = await open('embed=1', { width: 1366, height: 768 });
  const r = await page.evaluate(() => Object.fromEntries(['nasaq', 'liwan', 'base', 'brass', 'fayrouz', 'invalid'].map(i => [i, window.__fx.contract(i)])));
  out.contract = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { accepted: v.accepted, allowedChanged: v.allowedChanged, lockedChanged: v.lockedChanged, checks: v.modes.light.length, failing: Object.fromEntries(Object.entries(v.modes).map(([m, cs]) => [m, cs.filter(c => !c.pass).map(c => `${c.name} ${c.r}`)])), min: Object.fromEntries(Object.entries(v.modes).map(([m, cs]) => [m, Math.min(...cs.map(c => c.r / c.min)).toFixed(2)])) }]));
  for (const id of ['nasaq', 'liwan', 'base', 'brass', 'fayrouz']) assert(r[id].accepted, `${id} rejected: ${JSON.stringify(out.contract[id])}`);
  assert(!r.invalid.accepted, 'invalid accepted');
  assert(r.nasaq.lockedChanged.length === 0 && r.liwan.lockedChanged.length === 0, 'a direction changed a locked token');
  await ctx.close();
});

test('D1: amounts use physical right alignment with tabular figures in V3 (no A/B switch)', async () => {
  const { ctx, page } = await open('embed=1&r=sales', { width: 1366, height: 768 });
  for (const identity of IDS) {
    await setState(page, { identity });
    const r = await page.evaluate(() => ({ amt: document.querySelector('#fx-app').dataset.amt, ta: getComputedStyle(document.querySelector('.lines td.c-amt')).textAlign, tnum: getComputedStyle(document.querySelector('.dock .m')).fontVariantNumeric }));
    assert(r.amt === 'b' && r.ta === 'right' && /tabular-nums/.test(r.tnum), `${identity}: ${JSON.stringify(r)}`);
  }
  await ctx.close();
});

test('Navigation model per window class holds in both identities (bottom bar · rail · sidebar)', async () => {
  for (const [w, sel] of [[390, '.bbar'], [834, '.rail'], [1366, '.side']]) {
    const { ctx, page } = await open('embed=1', { width: w, height: 900 });
    for (const identity of IDS) {
      await setState(page, { identity });
      const v = await page.evaluate(() => ['.bbar', '.rail', '.side'].map(s => { const e = document.querySelector(s); const r = e?.getBoundingClientRect(); return !!(r && r.width && r.height && getComputedStyle(e).display !== 'none'); }));
      assert(v.filter(Boolean).length === 1 && v[['.bbar', '.rail', '.side'].indexOf(sel)], `${w}/${identity}: ${v}`);
    }
    await ctx.close();
  }
});

test('Dashboard: quick action opens a sales invoice; attention action opens the shift; cash chart has a data-table alternative', async () => {
  const { ctx, page } = await open('embed=1&r=dashboard', { width: 1366, height: 768 });
  await page.click('.qa .btn.primary');
  assert(await page.evaluate(() => window.__fx.S.route) === 'sales', 'quick action did not open sales');
  await setState(page, { route: 'dashboard' });
  await page.click('.att.sev-warn [data-route="shift"]');
  assert(await page.evaluate(() => window.__fx.S.route) === 'shift', 'attention action did not open shift');
  await setState(page, { route: 'dashboard' });
  await page.click('.as-table summary');
  assert(await page.locator('.as-table table tbody tr').count() === 6, 'cash table missing');
  await ctx.close();
});

test('Long invoice (80 lines): count, sticky header inside its own scroller, find filters without losing data', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=80', { width: 1366, height: 768 });
  assert(await page.evaluate(() => window.__fx.S.docs.sales.lines.length) === 80, 'fixture is not 80 lines');
  assert((await page.textContent('.lines-bar .cnt')).includes('80'), 'line count not shown');
  const r = await page.evaluate(() => { const sc = document.querySelector('.tscroll.tall'); sc.scrollTop = 900; const th = sc.querySelector('thead th'); return { sticky: getComputedStyle(th).position, d: Math.abs(th.getBoundingClientRect().top - sc.getBoundingClientRect().top), scrolls: sc.scrollHeight > sc.clientHeight }; });
  assert(r.sticky === 'sticky' && r.d < 2 && r.scrolls, 'header not sticky in the line scroller ' + JSON.stringify(r));
  await page.fill('#sales-lq', 'CMT-50'); await page.waitForTimeout(250);
  const vis = await page.evaluate(() => [...document.querySelectorAll('.lines tbody tr')].filter(tr => !tr.hidden).length);
  assert(vis === 10, `find should show 10 CMT-50 lines, shows ${vis}`);
  assert(await page.evaluate(() => window.__fx.S.docs.sales.lines.length) === 80, 'find changed the data');
  await page.fill('#sales-lq', ''); await page.waitForTimeout(250);
  assert(await page.evaluate(() => [...document.querySelectorAll('.lines tbody tr')].filter(tr => !tr.hidden).length) === 80, 'clearing find did not restore every line');
  await ctx.close();
});

test('Errors keep the typed data: line-numbered summary, "with errors" filter, link focuses the field inside the scroller', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=24&sc=errors', { width: 1366, height: 768 });
  const items = await page.$$eval('.err-summary li', l => l.map(x => x.textContent.trim()));
  assert(items.length === 2 && /البند 5/.test(items[0]) && /البند 12/.test(items[1]), 'summary lines ' + JSON.stringify(items));
  assert(await page.inputValue('#sales-l5-qty') === '12x' && await page.inputValue('#sales-l12-price') === '1.234', 'typed invalid text not kept');
  await page.click('[data-act="lines-filter"][data-v="err"]');
  assert(await page.evaluate(() => [...document.querySelectorAll('.lines tbody tr')].filter(tr => !tr.hidden).length) === 2, 'error filter');
  await page.click('[data-act="lines-filter"][data-v="all"]');
  await page.click('.err-summary li:nth-child(2) .lnk');
  const f = await page.evaluate(() => { const a = document.activeElement, sc = a.closest('.tscroll'); const r = a.getBoundingClientRect(), s = sc.getBoundingClientRect(); return { id: a.id, inView: r.top >= s.top - 1 && r.bottom <= s.bottom + 1 }; });
  assert(f.id === 'sales-l12-price' && f.inView, 'link did not focus the field in view ' + JSON.stringify(f));
  await page.fill('#sales-l12-price', '41.20'); await page.fill('#sales-l5-qty', '12');
  await page.locator('#main').focus(); await page.keyboard.press('Control+Enter');
  assert(await page.locator('.dlg [data-dr]').count() === 1, 'corrected invoice did not reach the posting preview');
  assert(await page.locator('.after-post li').count() === 3, 'post dialog lacks the after-posting explanation');
  await ctx.close();
});

test('A correction link to a line hidden by "find in lines" clears the find and focuses the field', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=24&sc=errors', { width: 1366, height: 768 });
  await page.fill('#sales-lq', 'GLV'); await page.waitForTimeout(250);
  assert(await page.evaluate(() => document.querySelector('#sales-l12-price').closest('tr').hidden), 'precondition: line 12 hidden by find');
  await page.click('.err-summary li:nth-child(2) .lnk');
  const r = await page.evaluate(() => ({ id: document.activeElement?.id, lq: window.__fx.S.docs.sales.lq, hidden: document.querySelector('#sales-l12-price').closest('tr').hidden }));
  assert(r.id === 'sales-l12-price' && r.lq === '' && !r.hidden, 'hidden line not revealed/focused ' + JSON.stringify(r));
  await ctx.close();
});

test('Recovery keeps the last saved draft: discard after reload returns to the save, not to a blank invoice', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(`${base}?r=sales&ln=3`); await page.evaluate(() => { localStorage.clear(); }); await page.reload();
  await page.fill('#sales-ref', 'SAVED-REF'); await page.locator('#main').focus(); await page.keyboard.press('Control+s'); await page.waitForTimeout(80);
  await page.fill('#sales-ref', 'UNSAVED-REF'); await page.waitForTimeout(80);
  await page.reload(); await page.waitForTimeout(200);
  assert(await page.inputValue('#sales-ref') === 'UNSAVED-REF' && await page.locator('.msg.recovered').count() === 1, 'unsaved edit not recovered');
  await page.click('[data-act="v3-discard"]'); await page.waitForTimeout(80);
  assert(await page.inputValue('#sales-ref') === 'SAVED-REF', 'discard did not return to the saved draft: ' + await page.inputValue('#sales-ref'));
  await page.evaluate(() => localStorage.clear()); await ctx.close();
});

test('Keyboard actions update recovery: Ctrl+S survives a reload with no "unsaved" notice; Alt+N line survives a reload', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(`${base}?r=sales&ln=3`); await page.evaluate(() => { localStorage.clear(); }); await page.reload();
  await page.fill('#sales-ref', 'KBD-SAVED'); await page.locator('#main').focus(); await page.keyboard.press('Control+s'); await page.waitForTimeout(80);
  await page.reload(); await page.waitForTimeout(200);
  assert(await page.inputValue('#sales-ref') === 'KBD-SAVED' && await page.locator('.msg.recovered').count() === 0, 'Ctrl+S save not kept across reload: ' + await page.inputValue('#sales-ref') + ' notice=' + await page.locator('.msg.recovered').count());
  const n = await page.locator('.lines tbody tr').count();
  await page.locator('#main').focus(); await page.keyboard.press('Alt+n'); await page.waitForTimeout(80);
  await page.reload(); await page.waitForTimeout(200);
  assert(await page.locator('.lines tbody tr').count() === n + 1 && await page.locator('.msg.recovered').count() === 1, 'Alt+N line lost on reload');
  await page.click('[data-act="v3-discard"]'); await page.waitForTimeout(80);
  assert(await page.locator('.lines tbody tr').count() === n && await page.inputValue('#sales-ref') === 'KBD-SAVED', 'discard did not return to the keyboard save');
  await page.evaluate(() => localStorage.clear()); await ctx.close();
});

test('Enter in a filtered invoice skips hidden rows; Enter on the last visible row adds a visible, focused line', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=24', { width: 1366, height: 768 });
  await page.fill('#sales-lq', 'CMT'); await page.waitForTimeout(250);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.lines tbody tr')].filter(tr => !tr.hidden).map(tr => tr.dataset.line));
  const all = await page.evaluate(() => [...document.querySelectorAll('.lines tbody tr')].map(tr => tr.dataset.line));
  assert(shown.length >= 2 && all.indexOf(shown[1]) - all.indexOf(shown[0]) > 1, 'precondition: find leaves a gap ' + JSON.stringify(shown));
  await page.focus(`#sales-l${shown[0]}-qty`); await page.keyboard.press('Enter');
  const f1 = await page.evaluate(() => document.activeElement?.id);
  assert(f1 === `sales-l${shown[1]}-qty`, `Enter went to ${f1}, expected next visible line ${shown[1]}`);
  await page.focus(`#sales-l${shown[shown.length - 1]}-qty`); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
  const f2 = await page.evaluate(() => { const a = document.activeElement; return { id: a?.id, hidden: a?.closest('tr')?.hidden, lq: window.__fx.S.docs.sales.lq, n: window.__fx.S.docs.sales.lines.length }; });
  assert(/^sales-l\d+-qty$/.test(f2.id || '') && !f2.hidden && f2.lq === '' && f2.n === all.length + 1, 'last visible row did not add a visible focused line ' + JSON.stringify(f2));
  await ctx.close();
});

test('"With errors" filter keeps the row being corrected visible until the field is left', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=24&sc=errors', { width: 1366, height: 768 });
  await page.click('[data-act="lines-filter"][data-v="err"]');
  await page.click('#sales-l5-qty', { clickCount: 3 }); await page.keyboard.type('25', { delay: 30 }); await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({ v: document.querySelector('#sales-l5-qty')?.value, id: document.activeElement?.id, hidden: document.querySelector('#sales-l5-qty')?.closest('tr').hidden }));
  assert(r.v === '25' && r.id === 'sales-l5-qty' && !r.hidden, 'edited row hidden or keystrokes lost ' + JSON.stringify(r));
  await page.focus('#sales-l12-price'); await page.fill('#sales-l12-price', '41.20'); await page.waitForTimeout(80);
  assert(await page.evaluate(() => window.__fx.S.docs.sales.lines.find(l => l.id === 5).qtyM) === 25000, 'corrected quantity not kept');
  await ctx.close();
});

test('"Add line" and Alt+N under find / error filter add a visible, focused line (no hidden lines)', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=24&sc=errors', { width: 1366, height: 768 });
  for (const how of ['button', 'alt']) {
    await page.click('[data-act="lines-filter"][data-v="err"]').catch(() => {});
    await page.fill('#sales-lq', 'CMT-50'); await page.waitForTimeout(250);
    const n = await page.evaluate(() => window.__fx.S.docs.sales.lines.length);
    if (how === 'button') await page.click('[data-act="add-line"]'); else { await page.locator('#main').focus(); await page.keyboard.press('Alt+n'); }
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => { const a = document.activeElement; return { id: a?.id, hidden: a?.closest('tr')?.hidden, lq: window.__fx.S.docs.sales.lq, n: window.__fx.S.docs.sales.lines.length }; });
    assert(r.n === n + 1 && /^sales-l\d+-qty$/.test(r.id || '') && !r.hidden && r.lq === '', `${how}: new line hidden or unfocused ` + JSON.stringify(r));
  }
  await ctx.close();
});

/* ---- navigation iconography (regression) ---- */
// The approved item → icon table. Changing an icon must change this table on purpose.
const NAV_ICON_TABLE = {
  dash: 'layout-dashboard', salesInv: 'file-plus-2', salesList: 'files', quotes: 'file-text', creditNotes: 'file-minus-2',
  purchInv: 'file-input', purchOrders: 'clipboard-list', suppliers: 'building-2', stock: 'boxes', permits: 'package-check',
  stocktaking: 'clipboard-check', customers: 'users', statements: 'scroll-text', journal: 'book-open-text', accounts: 'list-tree',
  treasury: 'landmark', expenses: 'receipt-text', employees: 'id-card', payroll: 'banknote', workorders: 'wrench',
  shift: 'calendar-clock', stations: 'fuel', tanks: 'cylinder', taxSettings: 'percent', roles: 'shield-check', reports: 'chart-column',
};
const navIconsOf = (page, sel) => page.evaluate((sel) => Object.fromEntries([...document.querySelectorAll(sel)].map(b => {
  const svg = b.querySelector('svg'); return [b.dataset.label, { icon: b.dataset.icon, shapes: svg ? svg.children.length : 0, body: svg ? svg.innerHTML : '' }];
})), sel);

test('Navigation icons: every item has its own approved icon, drawn (no missing symbol), identical in sidebar, mobile sheet and tablet group sheet', async () => {
  for (const identity of IDS) {
    const { ctx, page } = await open(`embed=1&id=${identity}&r=sales`, { width: 1366, height: 900 });
    const side = await navIconsOf(page, '.side .nav-a');
    assert(Object.keys(side).length === Object.keys(NAV_ICON_TABLE).length, `${identity}: sidebar items ${Object.keys(side).length}`);
    for (const [k, want] of Object.entries(NAV_ICON_TABLE)) {
      assert(side[k], `${identity}: sidebar has no ${k}`);
      assert(side[k].icon === want, `${identity}: ${k} shows ${side[k].icon}, expected ${want}`);
      assert(side[k].shapes > 0, `${identity}: ${k} icon is empty`);
    }
    // the same group never repeats one icon across all its items any more
    const groups = await page.evaluate(() => window.__fx.NAV.map(([g, , items]) => [g, items.map(it => window.__fx.navIcon(it))]));
    for (const [g, icons] of groups) if (icons.length > 1) assert(new Set(icons).size === icons.length, `${identity}: ${g} repeats an icon ${icons}`);
    await ctx.close();
    const m = await open(`embed=1&id=${identity}&r=sales`, { width: 390, height: 844 });
    await m.page.click('.bbar [data-act="navsheet"]');
    const sheet = await navIconsOf(m.page, '.sheet-nav .sheet-a');
    for (const [k, v] of Object.entries(side)) assert(sheet[k] && sheet[k].icon === v.icon && sheet[k].body === v.body, `${identity}: mobile sheet ${k} differs from sidebar`);
    await m.ctx.close();
    const tb = await open(`embed=1&id=${identity}&r=purchase`, { width: 834, height: 1112 });
    for (const g of ['g_sales', 'g_purch', 'g_inv', 'g_fin', 'g_fuel', 'g_set']) {
      await tb.page.click(`.rail [data-group="${g}"]`);
      const grp = await navIconsOf(tb.page, '.sheet-nav .sheet-a');
      assert(Object.keys(grp).length > 0, `${identity}: tablet ${g} sheet empty`);
      for (const [k, v] of Object.entries(grp)) assert(v.icon === side[k].icon && v.body === side[k].body, `${identity}: tablet ${g} ${k} differs`);
      await tb.page.keyboard.press('Escape');
    }
    // the rail keeps one icon per group
    const rail = await tb.page.evaluate(() => ({ n: window.__fx.NAV.length, shapes: [...document.querySelectorAll('.rail .rail-b')].map(b => b.querySelector('svg').children.length) }));
    assert(rail.shapes.length === rail.n && rail.shapes.every(n => n > 0), `${identity}: rail ${JSON.stringify(rail)}`);
    await tb.ctx.close();
  }
});

test('Navigation icons: an item without an icon, or with an unknown one, keeps its group icon (EXT.nav compatibility)', async () => {
  const { ctx, page } = await open('embed=1&r=sales', { width: 1366, height: 900 });
  const r = await page.evaluate(() => {
    const F = window.__fx, grp = F.NAV.find(n => n[0] === 'g_sales');
    grp[2].push(['tmpPlain', null], ['tmpUnknown', null, 'no-such-icon']);
    F.render();
    const pick = (k) => { const b = document.querySelector(`.side .nav-a[data-label="${k}"]`); return { icon: b.dataset.icon, shapes: b.querySelector('svg').children.length }; };
    const out = { plain: pick('tmpPlain'), unknown: pick('tmpUnknown') };
    grp[2].splice(-2, 2); F.render();
    return out;
  });
  assert(r.plain.icon === 'shopping-cart' && r.plain.shapes > 0, 'plain item did not fall back ' + JSON.stringify(r.plain));
  assert(r.unknown.icon === 'shopping-cart' && r.unknown.shapes > 0, 'unknown icon did not fall back ' + JSON.stringify(r.unknown));
  await ctx.close();
});

test('Mobile menu sheet: 44px rows, current item revealed below the sticky header, every item reachable, bottom bar unchanged', async () => {
  for (const identity of IDS) for (const [route, label] of [['sales', 'salesInv'], ['shift', 'shift']]) {
    const { ctx, page } = await open(`embed=1&id=${identity}&r=${route}`, { width: 390, height: 844 }, { reducedMotion: 'reduce' });
    const bbar = await page.evaluate(() => [...document.querySelectorAll('.bbar > button')].map(b => b.dataset.act || b.dataset.route));
    assert(JSON.stringify(bbar) === JSON.stringify(['dashboard', 'palette', 'create', 'inbox', 'navsheet']), `${identity}: bottom bar changed ${bbar}`);
    await page.click('.bbar [data-act="navsheet"]'); await page.waitForTimeout(60);
    const r = await page.evaluate((label) => {
      const sh = document.querySelector('.sheet-nav'), head = sh.querySelector('.sheet-h').getBoundingClientRect(), box = sh.getBoundingClientRect();
      const cur = sh.querySelector(`.sheet-a[data-label="${label}"]`).getBoundingClientRect();
      const heights = [...sh.querySelectorAll('.sheet-a')].map(b => b.offsetHeight); // layout height, unaffected by the opening transform
      sh.scrollTop = sh.scrollHeight; const last = [...sh.querySelectorAll('.sheet-a')].pop().getBoundingClientRect();
      return { minH: Math.min(...heights), curTop: cur.top, curBottom: cur.bottom, headBottom: head.bottom, boxBottom: box.bottom, lastBottom: last.bottom, current: sh.querySelector('[aria-current="page"]')?.dataset.label };
    }, label);
    assert(r.minH >= 44, `${identity}/${route}: row ${r.minH}px < 44`);
    assert(r.current === label, `${identity}/${route}: current ${r.current}`);
    assert(r.curTop >= r.headBottom - 0.5 && r.curBottom <= r.boxBottom + 0.5, `${identity}/${route}: current item hidden ${JSON.stringify(r)}`);
    assert(r.lastBottom <= r.boxBottom + 0.5, `${identity}/${route}: last item unreachable ${JSON.stringify(r)}`);
    await ctx.close();
  }
});

/* ---- Liwan refinement R1 (regression) ---- */
const GROUP_ICON_TABLE = { g_home: 'house', g_sales: 'shopping-cart', g_purch: 'truck', g_inv: 'package', g_parties: 'users', g_fin: 'calculator', g_hr: 'id-card', g_ops: 'hard-hat', g_fuel: 'fuel', g_set: 'settings' };
const ACTION_ICON_TABLE = { newSales: 'file-plus-2', newPurch: 'file-input', newReceipt: 'hand-coins', newPermit: 'package-check' };

test('One icon family: rail groups, create sheet and dashboard quick actions draw the approved Lucide shapes, the same as the menu for the same meaning', async () => {
  for (const identity of IDS) {
    const tb = await open(`embed=1&id=${identity}&r=purchase`, { width: 834, height: 1112 });
    const rail = await tb.page.evaluate(() => [...document.querySelectorAll('.rail .rail-b')].map(b => [b.dataset.group, b.querySelector('svg').innerHTML]));
    // the dictionary as the browser serialises it (self-closing tags come back expanded)
    const dict = await tb.page.evaluate(() => Object.fromEntries(Object.entries(window.AWJ_NAV_ICONS).map(([k, v]) => { const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); g.innerHTML = v; return [k, g.innerHTML]; })));
    assert(rail.length === Object.keys(GROUP_ICON_TABLE).length, `${identity}: rail groups ${rail.length}`);
    for (const [g, body] of rail) assert(GROUP_ICON_TABLE[g] && body === dict[GROUP_ICON_TABLE[g]], `${identity}: rail ${g} is not ${GROUP_ICON_TABLE[g]}`);
    await tb.ctx.close();
    const m = await open(`embed=1&id=${identity}&r=dashboard`, { width: 390, height: 844 });
    await m.page.click('.bbar [data-act="create"]');
    const create = await m.page.evaluate(() => [...document.querySelectorAll('.sheet .sheet-a')].map(b => [b.dataset.label, b.querySelector('svg').innerHTML]));
    for (const [k, want] of Object.entries(ACTION_ICON_TABLE)) { const hit = create.find(([l]) => l === k); assert(hit && hit[1] === dict[want], `${identity}: create ${k} is not ${want}`); }
    await m.page.keyboard.press('Escape');
    const qa = await m.page.evaluate(() => [...document.querySelectorAll('.qa .btn')].map(b => [b.dataset.route || '', b.querySelector('svg').innerHTML]));
    const want = { sales: 'file-plus-2', purchase: 'file-input', '': 'hand-coins', inventory: 'package-check', shift: 'calendar-clock' };
    assert(qa.length === 5 && qa.every(([r, body]) => body === dict[want[r]]), `${identity}: quick actions ${qa.map(q => q[0])}`);
    // a quick action shows the same shape as the menu item with the same meaning
    const side = await open(`embed=1&id=${identity}&r=dashboard`, { width: 1366, height: 900 });
    const sv = await side.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.side .nav-a')].map(b => [b.dataset.label, b.querySelector('svg').innerHTML])));
    assert(sv.salesInv === dict['file-plus-2'] && sv.purchInv === dict['file-input'] && sv.permits === dict['package-check'] && sv.shift === dict['calendar-clock'], `${identity}: menu and quick actions disagree`);
    await side.ctx.close(); await m.ctx.close();
  }
});

test('Sidebar keeps its scroll position across re-renders, and a route change brings the current item into view', async () => {
  for (const identity of IDS) {
    const { ctx, page } = await open(`embed=1&id=${identity}&r=sales`, { width: 1366, height: 640 });
    const r = await page.evaluate(() => {
      const ns = () => document.querySelector('.nav-scroll');
      const max = ns().scrollHeight - ns().clientHeight; ns().scrollTop = Math.min(140, max); const set = ns().scrollTop;
      window.__fx.render(); const kept = ns().scrollTop;
      return { max, set, kept };
    });
    assert(r.max > 100, `${identity}: precondition: sidebar scrolls ${r.max}`);
    assert(Math.abs(r.kept - r.set) <= 1, `${identity}: sidebar scroll reset by re-render ${JSON.stringify(r)}`);
    await page.evaluate(() => { document.querySelector('.nav-scroll').scrollTop = 0; });
    await page.evaluate(() => window.__fx.go('shift', true)); await page.waitForTimeout(60);
    const v = await page.evaluate(() => { const box = document.querySelector('.nav-scroll').getBoundingClientRect(), cur = document.querySelector('.nav-scroll [aria-current="page"]').getBoundingClientRect(); return { top: cur.top, bottom: cur.bottom, boxTop: box.top, boxBottom: box.bottom }; });
    assert(v.top >= v.boxTop - 0.5 && v.bottom <= v.boxBottom + 0.5, `${identity}: current item off-screen after route change ${JSON.stringify(v)}`);
    await ctx.close();
  }
});

test('Mobile menu: quick access one tap away (≥ 44px, current marked, labelled «وصول سريع»), full group order below unchanged', async () => {
  for (const identity of IDS) for (const l of ['ar', 'en']) {
    const { ctx, page } = await open(`embed=1&id=${identity}&l=${l}&r=sales`, { width: 390, height: 844 }, { reducedMotion: 'reduce' });
    await page.click('.bbar [data-act="navsheet"]');
    const r = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.nav-quick .quick-a')];
      const vw = document.documentElement.clientWidth;
      return { routes: tiles.map(b => b.dataset.route), minH: Math.min(...tiles.map(b => b.offsetHeight)), minW: Math.min(...tiles.map(b => b.offsetWidth)),
        current: tiles.filter(b => b.getAttribute('aria-current') === 'page').map(b => b.dataset.route),
        clipped: tiles.filter(b => b.scrollWidth > b.clientWidth + 1).length, inside: tiles.every(b => { const q = b.getBoundingClientRect(); return q.left >= 0 && q.right <= vw; }),
        order: [...document.querySelectorAll('.navlist .nav-sec .sheet-grp')].map(h => h.textContent), navOrder: window.__fx.NAV.map(([g]) => window.__fx.API.t(g)) };
    });
    assert(JSON.stringify(r.routes) === JSON.stringify(['sales', 'purchase', 'inventory', 'shift']), `${identity}/${l}: quick access ${r.routes}`);
    const head = await page.evaluate(() => document.querySelector('.nav-quick .sheet-grp').textContent);
    assert(head === (l === 'ar' ? 'وصول سريع' : 'Quick access'), `${identity}/${l}: quick access heading ${head}`);
    assert(r.minH >= 44 && r.minW >= 44, `${identity}/${l}: tile ${r.minW}x${r.minH}`);
    assert(JSON.stringify(r.current) === '["sales"]', `${identity}/${l}: current ${r.current}`);
    assert(r.clipped === 0 && r.inside, `${identity}/${l}: tile label clipped or off-screen`);
    assert(JSON.stringify(r.order) === JSON.stringify(r.navOrder), `${identity}/${l}: group order changed`);
    await page.click('.nav-quick [data-route="inventory"]'); await page.waitForTimeout(60);
    assert(await page.evaluate(() => window.__fx.S.route === 'inventory' && !window.__fx.S.overlay), `${identity}/${l}: quick-access tile did not navigate`);
    await ctx.close();
  }
});

test('Phone density: invoice line cards in three columns, inventory and invoice cards in paired rows, amounts never clipped or wrapped', async () => {
  for (const identity of IDS) for (const [l, m] of [['ar', 'light'], ['en', 'dark']]) for (const w of [390, 360]) {
    const { ctx, page } = await open(`embed=1&id=${identity}&l=${l}&m=${m}&r=sales&ln=6`, { width: w, height: 844 });
    const lines = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.lines tbody tr:not([hidden])')];
      const cols = getComputedStyle(rows[0]).gridTemplateColumns.split(' ').length;
      const ro = rows.flatMap(r => [...r.querySelectorAll('td.ro')]);
      const wrapped = (el) => { const tn = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).pop(); if (!tn) return false; const rg = document.createRange(); rg.selectNodeContents(tn); return rg.getClientRects().length > 1; };
      return { cols, maxH: Math.max(...rows.map(r => r.offsetHeight)), roBad: ro.filter(td => td.scrollWidth > td.clientWidth + 1 || wrapped(td)).length,
        inputs: rows.flatMap(r => [...r.querySelectorAll('.inp')]).filter(i => i.offsetWidth < 64 || i.offsetHeight < 44).length,
        del: Math.min(...rows.map(r => r.querySelector('.del .ibtn').offsetHeight)) };
    });
    assert(lines.cols === 3, `${identity}/${l}/${w}: line card has ${lines.cols} columns`);
    assert(lines.maxH <= 240, `${identity}/${l}/${w}: line card ${lines.maxH}px tall (was ~510)`);
    assert(lines.roBad === 0, `${identity}/${l}/${w}: VAT/total clipped or wrapped`);
    assert(lines.inputs === 0 && lines.del >= 44, `${identity}/${l}/${w}: touch target below 44px`);
    await page.evaluate(() => window.__fx.go('inventory', true)); await page.waitForTimeout(60);
    const inv = await page.evaluate(() => {
      const kv = [...document.querySelectorAll('.mlist .mcard .kv2')];
      const amt = kv.flatMap(d => [...d.querySelectorAll('dd')]);
      return { n: kv.length, cols: kv.length ? getComputedStyle(kv[0]).gridTemplateColumns.split(' ').length : 0,
        bad: amt.filter(dd => dd.scrollWidth > dd.clientWidth + 1 || dd.getClientRects().length > 1 || dd.getBoundingClientRect().height > 22).length };
    });
    assert(inv.n > 0 && inv.cols === 4, `${identity}/${l}/${w}: inventory cards not paired ${JSON.stringify(inv)}`);
    assert(inv.bad === 0, `${identity}/${l}/${w}: inventory value clipped or wrapped ${JSON.stringify(inv)}`);
    await ctx.close();
  }
});

test('An active line search keeps its field when deletions bring the invoice to ten lines or fewer', async () => {
  const { ctx, page } = await open('embed=1&l=en&r=sales&ln=24', { width: 1366, height: 900 });
  await page.fill('#sales-lq', 'p'); await page.waitForTimeout(300); // the find re-renders after a 140ms debounce
  for (let guard = 0; guard < 40; guard++) {
    const n = await page.evaluate(() => window.__fx.S.docs.sales.lines.length); if (n <= 10) break;
    await page.click('.lines tbody tr:not([hidden]) [data-del]'); await page.waitForTimeout(40);
  }
  const r = await page.evaluate(() => ({ n: window.__fx.S.docs.sales.lines.length, hidden: document.querySelectorAll('.lines tbody tr[hidden]').length, field: !!document.querySelector('#sales-lq') }));
  assert(r.n <= 10, 'precondition: ten lines or fewer ' + JSON.stringify(r));
  assert(r.hidden === 0 || r.field, 'lines hidden by a find with no field to clear it ' + JSON.stringify(r));
  await page.fill('#sales-lq', ''); await page.waitForTimeout(300);
  // clearing shows every line again (the field itself stays while focused, so typing never loses focus mid-edit)
  assert(await page.evaluate(() => document.querySelectorAll('.lines tbody tr[hidden]').length === 0), 'clearing the find did not show every line');
  await ctx.close();
});

test('"#app" from the compare view shows the app, not a blank page', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage(); await page.goto(`${base}`); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#c-view [data-view="compare"]'); await page.waitForTimeout(300);
  await page.click('a[href="#app"]'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => { const st = document.getElementById('stage'), b = st.getBoundingClientRect(); return { display: getComputedStyle(st).display, w: b.width, h: b.height, app: !!document.querySelector('#fx-app .fx-shell') }; });
  assert(r.display !== 'none' && r.w > 0 && r.h > 0 && r.app, '#app from compare is blank ' + JSON.stringify(r));
  await ctx.close();
});

/* ---- Liwan refinement R2 (regression) ---- */
test('Phone KPI labels: short (one line at 390, never cut below), no abbreviated tax term, «payable» in the note, full labels for screen readers; desktop unchanged', async () => {
  const FULL = { ar: { kRev: 'الإيرادات · الشهر حتى اليوم', kAP: 'مستحق للموردين خلال 7 أيام', kVat: 'ضريبة القيمة المضافة المستحقة', note: 'الربع الرابع · الإقرار حتى 31 يناير 2027' },
                 en: { kRev: 'Revenue · month to date', kAP: 'Payables due in 7 days', kVat: 'VAT payable', note: 'Q4 · return due 31 Jan 2027' } };
  for (const identity of IDS) for (const l of ['ar', 'en']) for (const [w, m] of [[390, 'light'], [320, 'dark']]) {
    const tag = `${identity}/${l}/${w}/${m}`;
    const { ctx, page } = await open(`embed=1&id=${identity}&l=${l}&m=${m}&r=dashboard`, { width: w, height: 844 });
    const r = await page.evaluate(() => {
      const seen = (el) => [...el.childNodes].filter(n => n.nodeType === 3 || getComputedStyle(n).display !== 'none' && !(n.classList && n.classList.contains('kl') && getComputedStyle(n).position === 'absolute')).map(n => n.textContent).join('').trim();
      return [...document.querySelectorAll('.kpi')].map(k => { const sp = k.querySelector('.kpi-h > span'), lh = parseFloat(getComputedStyle(sp).lineHeight), note = k.querySelector('.kpi-f .muted:last-child');
        return { k: k.dataset.k, text: seen(sp), lines: Math.round(sp.getBoundingClientRect().height / lh), cut: sp.scrollHeight > sp.clientHeight + 1, note: note ? seen(note) : '', tagW: note?.querySelector('.ks b') ? getComputedStyle(note.querySelector('.ks b')).fontWeight : null }; });
    });
    // one line at 390; on the narrowest phones (320) a label may take its second line, but is never cut
    for (const x of r) assert(w >= 390 ? x.lines === 1 : x.lines <= 2 && !x.cut, `${tag}: ${x.k} label on ${x.lines} lines${x.cut ? ', cut' : ''} "${x.text}"`);
    const by = Object.fromEntries(r.map(x => [x.k, x]));
    assert(!/ض\.ق\.م/.test(JSON.stringify(r)), `${tag}: abbreviated tax term still shown`);
    assert(by.kVat.text === (l === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT'), `${tag}: VAT label "${by.kVat.text}"`);
    const [tagWord, ...rest] = l === 'ar' ? ['المستحقة', 'الربع الرابع', '31 يناير 2027'] : ['Payable', 'Q4', '31 Jan 2027'];
    assert(by.kVat.note.startsWith(tagWord) && rest.every(s => by.kVat.note.includes(s)) && Number(by.kVat.tagW) >= 600, `${tag}: VAT note "${by.kVat.note}" (weight ${by.kVat.tagW})`);
    assert(l === 'ar' ? /الشهر/.test(by.kRev.text) && /7/.test(by.kAP.text) : /MTD/.test(by.kRev.text) && /7/.test(by.kAP.text), `${tag}: time context lost ${JSON.stringify(by)}`);
    // screen readers get the full, correct wording — and only once
    const aria = await page.locator('.kpi[data-k="kVat"]').ariaSnapshot();
    assert(aria.includes(FULL[l].kVat) && aria.includes(FULL[l].note), `${tag}: accessible text ${aria}`);
    assert(!aria.includes(`${tagWord} ·`), `${tag}: short note read aloud ${aria}`);
    for (const k of ['kRev', 'kAP']) assert((await page.locator(`.kpi[data-k="${k}"]`).ariaSnapshot()).includes(FULL[l][k]), `${tag}: ${k} full label missing for screen readers`);
    if (w === 390) {
      await page.setViewportSize({ width: 1366, height: 900 }); await page.waitForTimeout(80);
      const d = await page.evaluate(() => ({ rev: document.querySelector('.kpi[data-k="kRev"] .kpi-h > span').innerText.trim(), vat: document.querySelector('.kpi[data-k="kVat"] .kpi-h > span').innerText.trim(), note: document.querySelector('.kpi[data-k="kVat"] .kpi-f .muted:last-child').innerText.trim() }));
      assert(d.rev === FULL[l].kRev && d.vat === FULL[l].kVat && d.note === FULL[l].note, `${tag}: desktop changed ${JSON.stringify(d)}`);
    }
    await ctx.close();
  }
});

test('Tablet rail: every group name is readable in full (wraps, never cut)', async () => {
  for (const identity of IDS) for (const l of ['ar', 'en']) {
    const { ctx, page } = await open(`embed=1&id=${identity}&l=${l}&r=purchase`, { width: 834, height: 1112 });
    const bad = await page.evaluate(() => [...document.querySelectorAll('.rail .rail-b .lbl')].filter(s => s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1).map(s => s.textContent));
    assert(bad.length === 0, `${identity}/${l}: rail labels cut ${bad}`);
    await ctx.close();
  }
});

test('Phone «needs attention»: an item without an amount keeps its action beside the text; targets ≥ 44px; nothing overflows', async () => {
  for (const identity of IDS) for (const l of ['ar', 'en']) for (const w of [390, 360]) {
    const { ctx, page } = await open(`embed=1&id=${identity}&l=${l}&r=dashboard`, { width: w, height: 844 });
    const r = await page.evaluate(() => [...document.querySelectorAll('.att')].map(li => {
      const tx = li.querySelector('.tx').getBoundingClientRect(), b = li.querySelector('.btn').getBoundingClientRect(), box = li.getBoundingClientRect();
      return { amt: li.classList.contains('has-amt'), sameRow: b.top < tx.bottom, btnH: b.height, inside: b.left >= box.left - 0.5 && b.right <= box.right + 0.5, sub: parseFloat(getComputedStyle(li.querySelector('.tx span')).fontSize) };
    }));
    for (const x of r) {
      assert(x.btnH >= 44 && x.inside, `${identity}/${l}/${w}: action ${JSON.stringify(x)}`);
      assert(x.sub >= 12.5, `${identity}/${l}/${w}: secondary text ${x.sub}px`);
      if (!x.amt) assert(x.sameRow, `${identity}/${l}/${w}: action on its own row ${JSON.stringify(x)}`);
    }
    await ctx.close();
  }
});

test('Long invoice keeps its line-scroll position when a line is deleted', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=24', { width: 1366, height: 768 });
  const before = await page.evaluate(() => { const b = document.querySelector('.tscroll.tall'); b.scrollTop = b.scrollHeight; return b.scrollTop; });
  assert(before > 100, 'precondition: line box scrolls ' + before);
  await page.click('.lines tbody tr:nth-last-child(2) [data-del]'); await page.waitForTimeout(80);
  const after = await page.evaluate(() => document.querySelector('.tscroll.tall').scrollTop);
  assert(after > before - 120, `line scroll reset after delete: ${before} -> ${after}`);
  await ctx.close();
});

test('Draft vs post is explicit: lifecycle captions, draft note, Save draft keeps the document editable', async () => {
  const { ctx, page } = await open('embed=1&r=sales&ln=3', { width: 1366, height: 768 });
  assert(await page.locator('.lifecycle li small').count() === 3, 'lifecycle captions');
  assert(await page.locator('.draft-note').count() === 1, 'draft note');
  await page.fill('#sales-l1-disc', '5'); await page.locator('#main').focus(); await page.keyboard.press('Control+s'); await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({ dirty: window.__fx.S.docs.sales.dirty, editable: !document.querySelector('#sales-l1-qty').disabled, badge: document.querySelector('.doc-h .st')?.textContent }));
  assert(r.dirty === false && r.editable, 'draft save ' + JSON.stringify(r));
  await ctx.close();
});

test('Unsaved changes survive a reload: local recovery notice restores the typed values; discard returns to the last save', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(`${base}?r=sales&ln=3`); await page.evaluate(() => { localStorage.clear(); }); await page.reload();
  await page.fill('#sales-l2-qty', '33'); await page.waitForTimeout(80);
  await page.reload(); await page.waitForTimeout(200);
  assert(await page.locator('.msg.recovered').count() === 1, 'no recovery notice after reload');
  assert(await page.inputValue('#sales-l2-qty') === '33', 'typed value not restored');
  await page.click('[data-act="v3-discard"]'); await page.waitForTimeout(80);
  assert(await page.locator('.msg.recovered').count() === 0 && await page.inputValue('#sales-l2-qty') !== '33', 'discard did not return to the last save');
  await page.evaluate(() => localStorage.clear());
  await ctx.close();
});

test('Explorer compare view loads both identities side by side for the same screen and state', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage(); await page.goto(`${base}`); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#c-route button[data-v="sales"]');
  await page.click('#c-view [data-view="compare"]'); await page.waitForTimeout(1500);
  const srcs = await page.$$eval('#cmp iframe', f => f.map(x => x.getAttribute('src')));
  assert(srcs.length === 2 && /id=nasaq/.test(srcs[0]) && /id=liwan/.test(srcs[1]) && srcs.every(s => /r=sales/.test(s)), 'compare srcs ' + JSON.stringify(srcs));
  const ok = await Promise.all(page.frames().filter(f => /embed=1/.test(f.url())).map(f => f.evaluate(() => !!window.__fx && window.__fx.S.route)));
  assert(ok.length === 2 && ok.every(r => r === 'sales'), 'frames not rendered ' + JSON.stringify(ok));
  await ctx.close();
});

test('Mobile ergonomics: at 390px every action in the main area is ≥ 44px tall in both identities', async () => {
  const { ctx, page } = await open('embed=1', { width: 390, height: 844 });
  for (const identity of IDS) for (const route of ['dashboard', 'sales', 'shift']) {
    await setState(page, { identity, route }); await page.waitForTimeout(60);
    const small = await page.evaluate(() => [...document.querySelectorAll('#main button:not([role="option"]), #main select, #main input:not([type=checkbox])')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && r.height < 44 && !e.closest('[hidden]') && !e.closest('summary'); }).map(e => e.className + ':' + Math.round(e.getBoundingClientRect().height)));
    assert(!small.length, `${identity}/${route}: ${small.slice(0, 5).join(', ')}`);
  }
  await ctx.close();
});

test('Reduced motion: no transitions on controls in either identity', async () => {
  const { ctx, page } = await open('embed=1', { width: 1366, height: 768 }, { reducedMotion: 'reduce' });
  for (const identity of IDS) { await setState(page, { identity }); const d = await page.evaluate(() => getComputedStyle(document.querySelector('.qa .btn')).transitionDuration); assert(/^0s(, 0s)*$/.test(d), `${identity}: ${d}`); }
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
  for (const id of IDS) {
    for (const [w, h, full] of [[320, 640, 1], [390, 844, 1], [834, 1194, 0], [1366, 768, 0], [1920, 1080, 0], [2560, 1080, 0]]) list.push([`${id}-dashboard-${w}`, `id=${id}&r=dashboard`, w, h, full]);
    list.push([`${id}-dashboard-1366-dark`, `id=${id}&r=dashboard&m=dark`, 1366, 768, 0]);
    list.push([`${id}-dashboard-1366-en`, `id=${id}&r=dashboard&l=en`, 1366, 768, 0]);
    list.push([`${id}-dashboard-390-dark`, `id=${id}&r=dashboard&m=dark`, 390, 844, 0]);
    list.push([`${id}-sales-1366`, `id=${id}&r=sales&ln=24`, 1366, 768, 0]);
    list.push([`${id}-sales-1920-80lines`, `id=${id}&r=sales&ln=80`, 1920, 1080, 0]);
    list.push([`${id}-sales-1366-errors`, `id=${id}&r=sales&ln=24&sc=errors`, 1366, 900, 0]);
    list.push([`${id}-sales-1366-dark`, `id=${id}&r=sales&ln=24&m=dark`, 1366, 768, 0]);
    list.push([`${id}-sales-390`, `id=${id}&r=sales&ln=24`, 390, 844, 0]);
    list.push([`${id}-sales-768-en`, `id=${id}&r=sales&ln=24&l=en`, 768, 1024, 0]);
    list.push([`${id}-purchase-1366`, `id=${id}&r=purchase`, 1366, 768, 0]);
    list.push([`${id}-inventory-1366`, `id=${id}&r=inventory`, 1366, 768, 0]);
    list.push([`${id}-shift-390`, `id=${id}&r=shift`, 390, 844, 0]);
    list.push([`${id}-shift-1366-dark`, `id=${id}&r=shift&m=dark`, 1366, 768, 0]);
  }
  const run = previews ? list.filter(([n]) => PREVIEWS.includes(n)) : list;
  for (const [name, qs, w, h, full] of run) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    const page = await ctx.newPage(); await page.goto(`${base}?embed=1&${qs}${full ? '&full=1' : ''}`); await page.evaluate(() => document.fonts.ready);
    if (/inventory-1366/.test(name)) await page.evaluate(() => { const F = window.__fx; F.S.inv.peek = 'CBL-3X25'; F.S.inv.active = 'CBL-3X25'; F.render(); });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: !!full });
    await ctx.close();
  }
  // the explorer itself in compare mode
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1300 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('#c-device button[data-v="laptop"]'); await page.click('#c-view [data-view="compare"]'); await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotDir, 'explorer-compare.png'), fullPage: true }); await ctx.close();
  try {
    execFileSync('python3', ['-c', `import sys,glob,os
from PIL import Image
for p in glob.glob(os.path.join(sys.argv[1],'*.png')):
    im=Image.open(p)
    if im.height>16000: im=im.crop((0,0,im.width,16000))
    im.save(p[:-4]+'.webp','WEBP',quality=78,method=6); os.remove(p)`, shotDir]);
    console.log(`shots: ${run.length + 1} → WebP in ${path.relative(process.cwd(), shotDir)}`);
  } catch (e) { console.log(`shots: ${run.length + 1} PNG (Pillow unavailable)`); }
}

if (only !== 'interactions') await runMatrix();
if (only !== 'matrix') await runInteractions();
if (shots) await runShots();
await browser.close();
const file = path.join(root, 'signature', 'checks.json');
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const slim = out.matrix.map(r => r.ok ? { identity: r.identity, route: r.route, mode: r.mode, lang: r.lang, w: r.w, density: r.density, ok: true } : r);
const merged = { ...prev, ...out, matrix: slim.length ? slim : prev.matrix || [], interactions: out.interactions.length ? out.interactions : prev.interactions || [], summary: { ...(prev.summary || {}), ...out.summary } };
fs.writeFileSync(file, JSON.stringify(merged, null, 1));
process.exit((out.summary.matrix?.failed || 0) + (out.summary.interactions?.failed || 0) ? 1 : 0);
