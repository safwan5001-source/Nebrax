import { browser, login, WEB, log } from './lib.mjs';
const b = await browser(); const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const ev = []; page.on('requestfailed', (r) => /v1\/media/.test(r.url()) && ev.push('FAILED ' + r.url() + ' ' + r.failure()?.errorText)); page.on('response', (r) => /v1\/media/.test(r.url()) && ev.push(r.status() + ' ' + r.url())); page.on('console', (m) => /media|Content Security|img-src/i.test(m.text()) && ev.push('console: ' + m.text().slice(0, 200)));
await login(page); await page.goto(`${WEB}/commerce/appearance`); await page.waitForSelector('[data-experience-builder]', { timeout: 60000 }); await page.waitForTimeout(5000);
log(JSON.stringify(ev)); log(await page.locator('[data-preview-canvas] img').first().evaluate(i => i.src));
await b.close();
