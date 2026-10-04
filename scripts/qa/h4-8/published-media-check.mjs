import { browser, OUT, log } from './lib.mjs';
import { execSync } from 'node:child_process';
execSync('cd /home/user/nibras-app && php artisan cache:clear', { stdio: 'ignore' });
const b = await browser(['--host-resolver-rules=MAP *.h48.test 127.0.0.1']);
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const mediaReqs = [];
page.on('request', (r) => { if (/\/media\//.test(r.url()) && !/_next\/static/.test(r.url())) mediaReqs.push({ url: r.url() }); });
const mediaRes = [];
page.on('response', (r) => { if (/\/media\//.test(r.url()) && !/_next\/static/.test(r.url())) mediaRes.push({ url: r.url(), status: r.status() }); });
await page.goto('http://a.h48.test:3001/sa/ar', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(1500);

async function checkImg(sel, name) {
  const img = page.locator(sel).first();
  if ((await img.count()) === 0) { log(`${name}: NO <img> FOUND`); return; }
  const r = await img.evaluate((el) => ({ src: el.src, naturalWidth: el.naturalWidth, complete: el.complete }));
  log(`${name}:`, JSON.stringify(r));
}
await checkImg('section[aria-labelledby] img', 'first product image on homepage');

log('media requests:', JSON.stringify(mediaReqs));
log('media responses:', JSON.stringify(mediaRes));
log('all /store/v1/media are 200:', mediaRes.length > 0 && mediaRes.every(r => r.status === 200));
log('all media are /store/v1/media (not workspace/commerce):', mediaReqs.every(r => /\/store\/v1\/media/.test(r.url)));

await page.screenshot({ path: `${OUT}/published-media-check.png`, fullPage: true });
await b.close();
