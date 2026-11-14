// AWJ Design Lab — Phase 0 interaction smoke tests (real clicks/keys in Chromium).
// Usage: node design-lab/scripts/interactions.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** Playwright from this script's own resolution (global/NODE_PATH install with its browser),
 *  falling back to the repo's web/ dependency tree, so the checks run after `npm ci` in web/. */
function loadPlaywright() {
  const webPkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/package.json');
  for (const from of [import.meta.url, webPkg]) { try { return createRequire(from)('playwright'); } catch (e) { /* try next */ } }
  throw new Error('Playwright not found: run `npm ci` in web/ or install Playwright.');
}
const { chromium } = loadPlaywright();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = process.env.LAB === 'v2';
const url = pathToFileURL(path.join(root, V2 ? 'directions-v2' : 'directions', 'index.html')).href;

// CHROMIUM_PATH points at an existing Chrome/Chromium when the resolved Playwright's own browser build is not installed.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
async function test(name, viewport, fn) {
  const page = await browser.newPage({ viewport });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  try { await fn(page); if (errors.length) throw new Error(errors.join('; ')); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, String(e.message || e).slice(0, 300)]); }
  await page.close();
}
const set = (page, s) => page.evaluate((s) => { Object.assign(window.__awjLab.S, s); window.__awjLab.render(); }, s);
const app = '#app';
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };

for (const dir of (V2 ? ['astur', 'mash', 'kufi'] : ['qalam', 'mizan', 'fajr'])) {
  await test(`${dir}: table search narrows rows and empty state appears`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'table', device: 'laptop' });
    const before = await p.locator(`${app} tbody tr`).count();
    await p.fill('#tq', 'الواحة'); await p.waitForTimeout(250);
    const after = await p.locator(`${app} tbody tr`).count();
    if (!(after > 0 && after < before)) throw new Error(`rows ${before} -> ${after}`);
    await p.fill('#tq', 'zzzz-none'); await p.waitForTimeout(250);
    await p.locator(`${app} .state h3`).waitFor();
  });
  await test(`${dir}: sort by total toggles aria-sort and order`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'table', device: 'laptop' });
    await p.click(`${app} [data-sort="total"]`);
    eq(await p.getAttribute(`${app} th:has([data-sort="total"])`, 'aria-sort'), 'descending', 'aria-sort');
    const vals = await p.evaluate(() => window.__awjLab.S.sort.k);
    eq(vals, 'total', 'sort key');
    await p.click(`${app} [data-sort="total"]`);
    eq(await p.getAttribute(`${app} th:has([data-sort="total"])`, 'aria-sort'), 'ascending', 'aria-sort 2');
  });
  await test(`${dir}: status chip filters to overdue and selection shows bulk bar`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'table', device: 'laptop' });
    await p.click(`${app} [data-st="od"]`);
    const n = await p.locator(`${app} tbody tr`).count();
    const od = await p.locator(`${app} tbody .st-attention`).count();
    eq(od, n, 'all rows overdue');
    await p.click(`${app} [data-selall]`);
    await p.locator(`${app} .bulk`).waitFor();
  });
  await test(`${dir}: row opens detail with outcome surface; Esc closes`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'table', device: 'laptop' });
    await p.click(`${app} tbody tr:nth-child(5) .docno`);
    await p.locator(`${app} .insp .outcome`).waitFor();
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    eq(await p.locator(`${app} .insp`).count(), 0, 'inspector closed');
  });
  await test(`${dir}: Ctrl+K palette filters and navigates with keyboard`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'dash', device: 'laptop' });
    await p.click(`${app} .page-head`);
    await p.keyboard.press('Control+k');
    await p.locator('#pal-q').waitFor();
    await p.keyboard.type('وردية');
    await p.keyboard.press('Enter');
    eq(await p.evaluate(() => window.__awjLab.S.surface), 'shift', 'surface');
  });
  await test(`${dir}: invoice totals are integer-exact after edits; Enter adds a line`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'inv', device: 'laptop' });
    const line = `${app} tr[data-line="1"]`;
    await p.fill(`${line} [data-lf="qty"]`, '3');
    await p.fill(`${line} [data-lf="price"]`, '0.10');
    // 3 × 0.10 = 0.30 → VAT 0.045 → 0.05 (half-up on halalas), never 0.30000000000000004
    eq((await p.textContent(`${line} [data-lt="total"]`)).trim(), '0.35', 'line total');
    await p.focus(`${app} tbody tr:last-child [data-lf="disc"]`);
    const rows = await p.locator(`${app} tr[data-line]`).count();
    await p.keyboard.press('Enter');
    eq(await p.locator(`${app} tr[data-line]`).count(), rows + 1, 'line added');
  });
  await test(`${dir}: posting without customer shows inline error; with data shows journal preview`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'inv', device: 'laptop' });
    await p.click(`${app} [data-act="cust-change"]`);
    await p.click(`${app} [data-act="post"] >> nth=0`);
    await p.locator(`${app} #e-cust`).waitFor();
    await p.fill('#cust-q', 'مستشفى');
    await p.keyboard.press('Enter');
    await p.click(`${app} [data-act="post"] >> nth=0`);
    await p.locator(`${app} .je`).waitFor();
    const [d, c] = await p.evaluate(() => [...document.querySelectorAll('#app .je tfoot .money')].map(e => e.textContent));
    eq(d, c, 'entry balanced');
    await p.click(`${app} [data-act="confirm-post"]`);
    await p.locator(`${app} .toast`).waitFor();
  });
  await test(`${dir}: invalid price/discount keeps the typed text and blocks posting until fixed`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'inv', device: 'laptop' });
    const line = `${app} tr[data-line="2"]`;
    await p.fill(`${line} [data-lf="price"]`, '1.234');
    await p.fill(`${line} [data-lf="disc"]`, 'abc');
    await p.click(`${app} [data-act="post"] >> nth=0`);
    eq(await p.locator(`${app} .je`).count(), 0, 'no journal preview while invalid');
    eq(await p.inputValue(`${line} [data-lf="price"]`), '1.234', 'typed price kept after re-render');
    eq(await p.inputValue(`${line} [data-lf="disc"]`), 'abc', 'typed discount kept after re-render');
    eq(await p.getAttribute(`${line} [data-lf="disc"]`, 'aria-invalid'), 'true', 'still flagged');
    await p.fill(`${line} [data-lf="price"]`, '1.23');
    await p.fill(`${line} [data-lf="disc"]`, '0');
    await p.click(`${app} [data-act="post"] >> nth=0`);
    await p.locator(`${app} .je`).waitFor();
  });
  await test(`${dir}: changing a line's product clears a stale invalid price`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'inv', device: 'laptop' });
    const line = `${app} tr[data-line="2"]`;
    await p.fill(`${line} [data-lf="price"]`, 'abc');
    eq(await p.getAttribute(`${line} [data-lf="price"]`, 'aria-invalid'), 'true', 'abc flagged');
    const cur = await p.inputValue(`${line} [data-lf="p"]`);
    const other = await p.evaluate((sel) => [...document.querySelectorAll(sel + ' option')].map(o => o.value), `${line} [data-lf="p"]`);
    await p.selectOption(`${line} [data-lf="p"]`, other.find(v => v !== cur));
    const shown = await p.inputValue(`${line} [data-lf="price"]`);
    if (shown === 'abc') throw new Error('stale price text still shown');
    eq(await p.getAttribute(`${line} [data-lf="price"]`, 'aria-invalid'), null, 'price no longer flagged');
    await p.click(`${app} [data-act="post"] >> nth=0`);
    await p.locator(`${app} .je`).waitFor({ timeout: 3000 });
  });
  await test(`${dir}: correcting an invalid quantity by typing .5 keeps the decimal (qty 500, not 5000)`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'inv', device: 'laptop' });
    const line = `${app} tr[data-line="2"]`, q = `${line} [data-lf="qty"]`;
    await p.fill(q, 'abc');
    await p.click(`${app} [data-act="post"] >> nth=0`);
    eq(await p.locator(`${app} .je`).count(), 0, 'no preview while invalid');
    await p.fill(q, ''); await p.type(q, '.5', { delay: 30 });
    eq(await p.inputValue(q), '.5', 'typed text kept');
    eq(await p.evaluate(() => window.__awjLab.S.inv.lines.find(l => l.id === 2).qtyM), 500, 'stored quantity');
  });
  await test(`${dir}: correcting an invalid field keeps the caret in the field being edited`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'inv', device: 'laptop' });
    const line = `${app} tr[data-line="2"]`, q = `${line} [data-lf="qty"]`;
    await p.fill(q, '1x2');
    await p.click(`${app} [data-act="post"] >> nth=0`);
    eq(await p.locator(`${app} .je`).count(), 0, 'no preview while invalid');
    await p.focus(q); await p.evaluate((q) => document.querySelector(q).setSelectionRange(1, 2), q);
    await p.keyboard.type('05', { delay: 30 });
    eq(await p.inputValue(q), '1052', 'typed text');
    eq(await p.evaluate(() => window.__awjLab.S.inv.lines.find(l => l.id === 2).qtyM), 1052000, 'stored quantity');
  });
  await test(`${dir}: invoice header edits survive adding a line and changing the customer`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'inv', device: 'laptop' });
    await p.fill('#f-date', '2026-11-05');
    await p.fill('#f-due', '2026-12-31');
    await p.fill('#f-ref', 'PO-90001');
    await p.selectOption('#f-br', 'khb');
    await p.click(`${app} [data-act="add-line"]`);
    await p.click(`${app} [data-act="cust-change"]`);
    await p.fill('#cust-q', 'مستشفى');
    await p.keyboard.press('Enter');
    eq(await p.inputValue('#f-date'), '2026-11-05', 'date');
    eq(await p.inputValue('#f-due'), '2026-12-31', 'due');
    eq(await p.inputValue('#f-ref'), 'PO-90001', 'ref');
    eq(await p.inputValue('#f-br'), 'khb', 'branch');
  });
  await test(`${dir}: fuel shift blocks closing below opening and computes liters`, { width: 390, height: 844 }, async (p) => {
    await set(p, { dir, surface: 'shift', device: 'wide' });
    await p.fill(`${app} [data-reading="N1"]`, '284000');
    await p.waitForTimeout(450);
    await p.locator(`${app} #e-N1`).waitFor();
    await p.fill(`${app} [data-reading="N1"]`, '285012.37');
    await p.waitForTimeout(450);
    eq(await p.locator(`${app} #e-N1`).count(), 0, 'error cleared');
    const txt = await p.textContent(`${app} .nz:nth-child(1) .out b`);
    eq(txt.trim(), '500', 'liters');
  });
  await test(`${dir}: saving readings is enabled only when every reading is present and valid`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'shift', device: 'laptop' });
    const save = `${app} .page-head [data-act="save-readings"]`;
    eq(await p.isDisabled(save), true, 'disabled while readings missing');
    const fill = async (id, v) => { await p.fill(`${app} [data-reading="${id}"]`, v); await p.waitForTimeout(450); };
    await fill('N1', '285012.37'); await fill('N3', '413100'); await fill('N4', '377000');
    eq(await p.isDisabled(save), true, 'disabled while one reading is below opening');
    await fill('N4', '377500');
    eq(await p.isDisabled(save), false, 'enabled when all four are valid');
    await p.click(`${app} .next [data-act="save-readings"]`);
    await p.locator(`${app} .toast`).waitFor();
  });
  await test(`${dir}: Tab right after typing a reading keeps focus on the next field`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'shift', device: 'laptop' });
    await p.click(`${app} [data-reading="N1"]`);
    await p.keyboard.type('285012.37');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Tab');
    const before = await p.evaluate(() => document.activeElement?.dataset?.reading || document.activeElement?.id);
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => document.activeElement?.dataset?.reading || document.activeElement?.id);
    eq(after, before, 'focus not pulled back after the deferred render');
    if (after === 'N1') throw new Error('focus returned to N1');
  });
  await test(`${dir}: Shift+Tab and Tab stay inside the open command palette`, { width: 1440, height: 1000 }, async (p) => {
    await set(p, { dir, surface: 'dash', device: 'laptop' });
    await p.click(`${app} .page-head`);
    await p.keyboard.press('Control+k');
    await p.locator('#pal-q').waitFor();
    for (const k of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab']) {
      await p.keyboard.press(k);
      const inside = await p.evaluate(() => !!document.activeElement?.closest('#app .overlay'));
      if (!inside) throw new Error(`focus left the palette after ${k}`);
    }
  });
  await test(`${dir}: phone tab bar navigates; touch targets ≥ 44px`, { width: 390, height: 844 }, async (p) => {
    await set(p, { dir, surface: 'dash', device: 'wide' });
    await p.click(`${app} .tabbar [data-go="table"]`);
    eq(await p.evaluate(() => window.__awjLab.S.surface), 'table', 'surface');
    const small = await p.evaluate(() => [...document.querySelectorAll('#app .tabbar button, #app .topbar button, #app .f-row button, #app .a-top button, #app .m-top button, #app .k-top button, #app .mcard, #app .fchip, #app .btn')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44 && !b.classList.contains('fchip')).map(b => b.className));
    if (small.length) throw new Error('small targets: ' + small.slice(0, 5).join(','));
  });
}
await test('LTR/English renders with dir=ltr and English labels', { width: 1440, height: 1000 }, async (p) => {
  await set(p, { dir: V2 ? 'mash' : 'mizan', surface: 'table', device: 'laptop', lang: 'en' });
  eq(await p.getAttribute(app, 'dir'), 'ltr', 'dir');
  await p.getByText('Sales invoices').first().waitFor();
});
await browser.close();
for (const r of results) console.log(r.join(' | '));
const fails = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
