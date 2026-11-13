// AWJ Signature V3 — navigation before/after captures (Design Lab only).
// Usage:
//   node design-lab/signature/tools/signature-nav-previews.mjs --tag=after            # full set → design-lab/signature/out/nav/<tag>/ (git-ignored)
//   node design-lab/signature/tools/signature-nav-previews.mjs --tag=after --commit   # the key previews → design-lab/signature/previews/nav/
// Shots: mobile nav sheet (390), mobile sheet scrolled to the end, desktop sidebar (1366), tablet group sheet (834),
// for Nasaq and Liwan × ar/en × light/dark. Committed set: ar light, both identities, written as PNG then converted to
// webp with tools/nav-previews-webp.py (also builds the before/after comparison sheets).
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
const dir = commit ? path.join(root, 'signature', 'previews', 'nav') : path.join(root, 'signature', 'out', 'nav', tag);
fs.mkdirSync(dir, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const combos = commit ? [['ar', 'light']] : [['ar', 'light'], ['ar', 'dark'], ['en', 'light'], ['en', 'dark']];
const shots = [
  { name: 'mobile-sheet', vp: { width: 390, height: 844 }, route: 'sales', overlay: { t: 'navsheet' } },
  { name: 'mobile-sheet-end', vp: { width: 390, height: 844 }, route: 'sales', overlay: { t: 'navsheet' }, scrollEnd: true },
  { name: 'sidebar', vp: { width: 1366, height: 1000 }, route: 'sales', clip: '.side' },
  { name: 'tablet-group', vp: { width: 834, height: 1112 }, route: 'purchase', overlay: { t: 'group', g: 'g_purch' } },
];
for (const id of ['nasaq', 'liwan']) for (const [l, m] of combos) for (const s of shots) {
  if (commit && s.name === 'mobile-sheet-end') continue;
  const ctx = await browser.newContext({ viewport: s.vp, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}?embed=1&id=${id}&l=${l}&m=${m}&r=${s.route}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((o) => { const F = window.__fx; F.S.overlay = o || null; F.render(); }, s.overlay);
  await page.waitForTimeout(150);
  if (s.scrollEnd) await page.evaluate(() => { const sh = document.querySelector('.sheet'); sh.scrollTop = sh.scrollHeight; });
  const file = path.join(dir, `${commit ? tag + '-' : ''}${id}-${s.name}${commit ? '' : `-${l}-${m}`}.png`);
  if (s.clip) await page.locator(s.clip).screenshot({ path: file });
  else await page.screenshot({ path: file });
  await ctx.close();
}
await browser.close();
console.log(`nav previews (${tag}) → ${path.relative(path.resolve(root, '..'), dir)}`);
