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
