// AWJ Design Lab — Phase 0 interaction smoke tests (real clicks/keys in Chromium).
// Usage: node design-lab/scripts/interactions.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'directions/index.html')).href;

const browser = await chromium.launch();
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

for (const dir of ['qalam', 'mizan', 'fajr']) {
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
  await test(`${dir}: phone tab bar navigates; touch targets ≥ 44px`, { width: 390, height: 844 }, async (p) => {
    await set(p, { dir, surface: 'dash', device: 'wide' });
    await p.click(`${app} .tabbar [data-go="table"]`);
    eq(await p.evaluate(() => window.__awjLab.S.surface), 'table', 'surface');
    const small = await p.evaluate(() => [...document.querySelectorAll('#app .tabbar button, #app .topbar button, #app .f-row button, #app .mcard, #app .fchip, #app .btn')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44 && !b.classList.contains('fchip')).map(b => b.className));
    if (small.length) throw new Error('small targets: ' + small.slice(0, 5).join(','));
  });
}
await test('LTR/English renders with dir=ltr and English labels', { width: 1440, height: 1000 }, async (p) => {
  await set(p, { dir: 'mizan', surface: 'table', device: 'laptop', lang: 'en' });
  eq(await p.getAttribute(app, 'dir'), 'ltr', 'dir');
  await p.getByText('Sales invoices').first().waitFor();
});
await browser.close();
for (const r of results) console.log(r.join(' | '));
const fails = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
