// usage: node browser.mjs out.json file1 file2 ...   (mime by extension). Uses Chromium WebCodecs ImageDecoder + <img>.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/home/user/Nebrax/web/package.json');
const { chromium } = require('playwright-core');
const [out, ...files] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.route('http://localhost/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
await page.goto('http://localhost/');
const res = {};
const B = 25;
for (let i = 0; i < files.length; i += B) {
  const batch = files.slice(i, i + B).map(f => ({ f, type: f.endsWith('.gif') ? 'image/gif' : 'image/webp', b64: fs.readFileSync(f).toString('base64') }));
  const r = await page.evaluate(async (batch) => {
    const out = {};
    for (const it of batch) {
      const bytes = Uint8Array.from(atob(it.b64), c => c.charCodeAt(0));
      const o = {};
      try {
        const d = new ImageDecoder({ data: bytes, type: it.type });
        await d.tracks.ready;
        await Promise.race([d.completed, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 5000))]);
        const t = d.tracks.selectedTrack;
        o.frames = t.frameCount; o.animated = t.animated;
        try { const fr = await d.decode({ frameIndex: Math.max(0, t.frameCount - 1) }); o.w = fr.image.displayWidth; o.h = fr.image.displayHeight; fr.image.close(); } catch (e) { o.decodeErr = String(e).slice(0, 60); }
        d.close();
      } catch (e) { o.err = String(e).slice(0, 80); }
      try {
        const url = URL.createObjectURL(new Blob([bytes], { type: it.type }));
        const im = new Image(); im.src = url;
        await Promise.race([im.decode(), new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 5000))]);
        o.imgW = im.naturalWidth; o.imgH = im.naturalHeight; URL.revokeObjectURL(url);
      } catch (e) { o.imgErr = String(e).slice(0, 60); }
      out[it.f] = o;
    }
    return out;
  }, batch);
  Object.assign(res, r);
}
fs.writeFileSync(out, JSON.stringify(res));
await browser.close();
