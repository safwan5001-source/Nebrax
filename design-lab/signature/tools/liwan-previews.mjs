// AWJ Signature V3 — Liwan refinement before/after captures (Design Lab only).
// Usage:
//   node design-lab/signature/tools/liwan-previews.mjs --tag=before            # full set → signature/out/liwan/<tag>/ (git-ignored)
//   node design-lab/signature/tools/liwan-previews.mjs --tag=after --commit    # key previews → signature/previews/liwan/ (PNG; convert with liwan-previews-webp.py)
//   options: --set=liwan-r2 (previews/<set>/ and out/<set>/) · --only=dashboard-390,nav-sheet (shot names) · --langs=ar,en (committed languages)
// Full set: Liwan and the Nasaq reference × dashboard/sales/inventory/shift × phone 390 (full page) and laptop 1366,
// ar and en, light and dark, plus the navigation (sidebar, mobile menu sheet, tablet rail).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const webPkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/package.json');
const { chromium } = (() => { for (const f of [import.meta.url, webPkg]) { try { return createRequire(f)('playwright'); } catch (e) { /* next */ } } throw new Error('Playwright not found'); })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = pathToFileURL(path.join(root, 'signature', 'index.html')).href;
const argv = process.argv.slice(2);
const tag = (argv.find(a => a.startsWith('--tag=')) || '--tag=after').split('=')[1];
const commit = argv.includes('--commit');
const opt = (k, d) => (argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1];
const set = opt('set', 'liwan'), only = opt('only', '').split(',').filter(Boolean), langs = opt('langs', 'ar').split(',');
const dir = commit ? path.join(root, 'signature', 'previews', set) : path.join(root, 'signature', 'out', set, tag);
fs.mkdirSync(dir, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const PHONE = { width: 390, height: 844 }, LAPTOP = { width: 1366, height: 900 }, TABLET = { width: 834, height: 1112 };
const screens = ['dashboard', 'sales', 'inventory', 'shift'];
const shots = [
  ...screens.map(r => ({ name: `${r}-390`, vp: PHONE, route: r, full: true })),
  ...screens.map(r => ({ name: `${r}-1366`, vp: LAPTOP, route: r })),
  { name: 'nav-sidebar', vp: { width: 1366, height: 1000 }, route: 'sales', clip: '.side' },
  { name: 'nav-sheet', vp: PHONE, route: 'sales', overlay: { t: 'navsheet' } },
  { name: 'nav-rail', vp: TABLET, route: 'purchase', clip: '.rail' },
];
// committed key set: Liwan ar light (all shots) + Nasaq reference for the phone screens and the sidebar
const committed = (id, s) => id === 'liwan' || ['dashboard-390', 'sales-390', 'inventory-390', 'nav-sidebar'].includes(s.name);
const combos = commit ? langs.map(l => [l, 'light']) : [['ar', 'light'], ['ar', 'dark'], ['en', 'light'], ['en', 'dark']];
for (const id of ['liwan', 'nasaq']) for (const [l, m] of combos) for (const s of shots) {
  if (commit && !committed(id, s)) continue;
  if (only.length && !only.includes(s.name)) continue;
  const ctx = await browser.newContext({ viewport: s.vp, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}?embed=1&id=${id}&l=${l}&m=${m}&r=${s.route}${s.full ? '&full=1' : ''}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  if (s.overlay) await page.evaluate((o) => { const F = window.__fx; F.S.overlay = o; F.render(); }, s.overlay);
  await page.waitForTimeout(150);
  const file = path.join(dir, `${commit ? tag + '-' : ''}${id}-${s.name}${commit ? (l === 'ar' ? '' : `-${l}`) : `-${l}-${m}`}.png`);
  if (s.clip) await page.locator(s.clip).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: !!s.full });
  await ctx.close();
}
await browser.close();
console.log(`liwan previews (${tag}) → ${path.relative(path.resolve(root, '..'), dir)}`);
