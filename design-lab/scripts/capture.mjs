// AWJ Design Lab — Phase 0 capture & checks.
// Usage: node design-lab/scripts/capture.mjs [--shots] [--scale=1]
// Loads design-lab/directions/index.html in Chromium (pre-installed Playwright), drives the lab
// state through window.__awjLab, and for every direction × surface × device:
//   • fails on console/page errors
//   • measures horizontal overflow of the app frame's scroll container and of the page body
//   • runs axe-core (WCAG 2.x A/AA rules) against the app frame
// With --shots it also writes PNGs to design-lab/directions/screens/.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const page_url = pathToFileURL(path.join(root, 'directions/index.html')).href;
const axePath = path.resolve(root, '../web/node_modules/axe-core/axe.min.js');
const shots = process.argv.includes('--shots');
const scale = Number((process.argv.find(a => a.startsWith('--scale=')) || '--scale=1').split('=')[1]);
const outDir = path.join(root, 'directions/screens');
fs.mkdirSync(outDir, { recursive: true });

const DIRS = ['qalam', 'mizan', 'fajr'];
const SURFACES = ['dash', 'table', 'inv', 'shift'];
const DEVICES = ['phone', 'tablet', 'laptop'];

const browser = await chromium.launch();
const results = [];
async function run(viewport, cfg, shotName) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: cfg.mode === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  await page.goto(page_url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((c) => {
    try { localStorage.clear(); } catch (e) {}
    const L = window.__awjLab; Object.assign(L.S, c); L.render();
  }, cfg);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const m = await page.evaluate(() => {
    const main = document.querySelector('#main');
    const app = document.querySelector('#app');
    const over = [...app.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect(); const a = app.getBoundingClientRect();
      if (!r.width || el.closest('.tbl-scroll,.attn,.fchips,.hubs,.dock .parts,.cmp-wrap,[style*="overflow-x:auto"],.overlay')) return false;
      return r.right > a.right + 1 || r.left < a.left - 1;
    }).slice(0, 5).map(el => el.className || el.tagName);
    return { mainOverflow: main.scrollWidth - main.clientWidth, bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, escapees: over };
  });
  await page.addScriptTag({ path: axePath });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run('#app', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), why: v.nodes.slice(0,3).map(n => n.target.join(" ") + " :: " + (n.any[0]?.message || "")) }));
  });
  if (shotName) {
    const el = await page.$(viewport.width <= 520 ? '#app' : '.stage-wrap');
    await el.screenshot({ path: path.join(outDir, shotName + '.png') });
  }
  results.push({ ...cfg, vw: viewport.width, errors, ...m, axe });
  await ctx.close();
}

for (const dir of DIRS) for (const surface of SURFACES) for (const device of DEVICES) {
  for (const mode of ['light', 'dark']) {
    const vw = device === 'phone' ? 390 : device === 'tablet' ? 900 : 1440;
    const name = shots && mode === 'light' ? `${dir}-${surface}-${device}` : (shots && mode === 'dark' && device === 'laptop' && surface === 'dash' ? `${dir}-${surface}-${device}-dark` : null);
    await run({ width: vw, height: device === 'phone' ? 844 : 1000 }, { dir, surface, device: device === 'phone' ? 'wide' : device, mode, lang: 'ar' }, name);
  }
}
// LTR spot checks
for (const dir of DIRS) await run({ width: 1440, height: 1000 }, { dir, surface: 'table', device: 'laptop', mode: 'light', lang: 'en' }, shots ? `${dir}-table-laptop-en` : null);
// 320px smallest phone + states
for (const dir of DIRS) for (const demo of ['loading', 'empty', 'error']) await run({ width: 320, height: 700 }, { dir, surface: 'table', device: 'wide', mode: 'light', lang: 'ar', demo }, shots && dir === 'mizan' ? `${dir}-table-320-${demo}` : null);
await browser.close();

const bad = results.filter(r => r.errors.length || r.mainOverflow > 1 || r.bodyOverflow > 1 || r.escapees.length);
const axeAgg = {};
for (const r of results) for (const v of r.axe) { const k = `${v.id} (${v.impact})`; axeAgg[k] = axeAgg[k] || { runs: 0, nodes: 0, sample: v.sample, why: v.why, where: `${r.dir}/${r.surface}/${r.device}/${r.mode}` }; axeAgg[k].runs++; axeAgg[k].nodes += v.n; }
const summary = { runs: results.length, layoutOrErrorFailures: bad.map(b => ({ cfg: `${b.dir}/${b.surface}/${b.device}/${b.mode}/${b.lang}${b.demo ? '/' + b.demo : ''}@${b.vw}`, errors: b.errors, mainOverflow: b.mainOverflow, bodyOverflow: b.bodyOverflow, escapees: b.escapees })), axe: axeAgg };
fs.writeFileSync(path.join(root, 'directions/checks.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
