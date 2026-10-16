import { createRequire } from 'module'; import fs from 'fs'; import { execSync } from 'child_process';
const require = createRequire('/home/user/Nebrax/web/package.json');
const { chromium } = require('playwright-core');
const f = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route('http://localhost/**', r => { if (r.request().url().endsWith('/img')) r.fulfill({ contentType: f.endsWith('.gif') ? 'image/gif' : 'image/webp', body: fs.readFileSync(f) }); else r.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><img id=i src="/img" style="width:1280px"></body></html>' }); });
const rss = () => execSync("ps -eo rss,args | grep -- '--type=renderer' | grep -v grep | awk '{s+=$1} END {print int(s/1024)}'").toString().trim();
await page.goto('about:blank'); await new Promise(r => setTimeout(r, 1500)); const base = rss();
await page.goto('http://localhost/'); 
const samples = [];
for (let t = 0; t < 12; t++) { await new Promise(r => setTimeout(r, 1500)); samples.push(rss()); }
console.log(JSON.stringify({ file: f, baseline_renderer_MB: base, renderer_MB_over_time: samples }));
await browser.close();
