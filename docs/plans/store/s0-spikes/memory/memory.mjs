// F3 memory assessment — NOT production code. Measures real Chromium renderer RSS while an animated GIF/WebP is shown.
// usage: node memory.mjs <file[,file2,file3]> <scenario> <profile> [seconds=10]      (HEADED=1 → headed Chromium under xvfb-run; CHROME_ARGS="--enable-low-end-device-mode" → Chromium low-RAM-device mode)
//   scenario: single | rotate3 (stack3 where the active slide changes every 8 s — slider behaviour) | stack3 (3 slides, inactive = opacity:0, like HomeSlider) | visible3 | offscreen3 (translateX(100%)) | hidden3 (display:none)
//   profile : desktop (1440x900 @1x) | mobile (390x844 @3x, isMobile, touch)
// NOTE: headless Chromium DOES advance the animation in real time and decodes a frame when it is first shown, so RSS keeps
// growing for one full loop (frames × delay). Use secs ≥ loop length + margin (this fixture set uses 100 ms frames).
// RSS is summed over all `--type=renderer` processes (baseline = about:blank). Physical devices are NOT measured here.
import { createRequire } from 'module';
import fs from 'fs';
import { execSync } from 'child_process';
const require = createRequire('/home/user/Nebrax/web/package.json');
const { chromium } = require('playwright-core');
const [file, scenario = 'single', profile = 'desktop', secs = '10'] = process.argv.slice(2);
const files = file.split(',');
const bodies = files.map((f) => fs.readFileSync(f));
const body = bodies[0];
const ctype = files[0].endsWith('.gif') ? 'image/gif' : 'image/webp';
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, headless: !process.env.HEADED, args: ['--no-sandbox', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [])] });
const ctx = await browser.newContext(profile === 'mobile'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const n = scenario === 'single' ? 1 : 3;
const rotate = scenario === 'rotate3';
const css = {
  single: '', rotate3: '.s{position:absolute;inset:0;opacity:0}.s.on{opacity:1}', stack3: '.s{position:absolute;inset:0}.s:nth-of-type(n+2){opacity:0}',
  visible3: '.s{display:inline-block;width:32%;vertical-align:top}', offscreen3: '.s{position:absolute;inset:0}.s:nth-of-type(n+2){transform:translateX(100%)}',
  hidden3: '.s:nth-of-type(n+2){display:none}',
}[scenario];
const imgs = Array.from({ length: n }, (_, i) => `<div class="s${rotate && i === 0 ? ' on' : ''}"><img data-i="${i}" src="/img${i}?${Date.now()}" style="width:100%;display:block"></div>`).join('');
await page.route('http://x.test/**', (r) => {
  const u = new URL(r.request().url());
  if (u.pathname.startsWith('/img')) { const i = Number(u.pathname.slice(4)); r.fulfill({ contentType: ctype, body: bodies[i % bodies.length], headers: { 'cache-control': 'no-store' } }); }
  else r.fulfill({ contentType: 'text/html', body: `<html><body style="margin:0;position:relative;height:100vh"><style>${css}</style>${imgs}</body></html>` });
});
const rss = () => Number(execSync("ps -eo rss,args | grep -- '--type=renderer' | grep -v grep | awk '{s+=$1} END {print int(s/1024)}'").toString().trim() || 0);
await page.goto('about:blank'); await new Promise((r) => setTimeout(r, 1500)); const base = rss();
await page.goto('http://x.test/');
const samples = []; const seen = new Set();
for (let t = 0; t < Number(secs); t++) {
  await new Promise((r) => setTimeout(r, 1000)); samples.push(rss());
  if (rotate && t % 8 === 7) await page.evaluate((k) => document.querySelectorAll('.s').forEach((e, i) => e.classList.toggle('on', i === k)), Math.floor((t + 1) / 8) % 3);
  const c = await page.evaluate(() => { const im = document.querySelector('img'); if (!im || !im.naturalWidth) return null; const k = document.createElement('canvas'); k.width = k.height = 1; const x = k.getContext('2d'); x.drawImage(im, 0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(','); });
  if (c) seen.add(c);
}
const dims = await page.evaluate(() => { const im = document.querySelector('img'); return im ? [im.naturalWidth, im.naturalHeight] : null; });
await browser.close();
const peak = Math.max(...samples), last = samples[samples.length - 1];
console.log(JSON.stringify({ file: files.map((f) => f.split('/').pop()).join(','), scenario, profile, headed: !!process.env.HEADED, chrome_args: process.env.CHROME_ARGS || null, natural: dims, distinct_files: files.length, file_kb: Math.round(bodies.reduce((a, b) => a + b.length, 0) / 1024), baseline_mb: base, peak_mb: peak, last_mb: last, delta_peak_mb: peak - base, animation_advanced: seen.size > 1, samples }));
