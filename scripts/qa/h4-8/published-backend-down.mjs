import { browser, log } from './lib.mjs';
const b = await browser(['--host-resolver-rules=MAP *.h48.test 127.0.0.1']); const page = await (await b.newContext()).newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 80)));
const r = await page.goto('http://a.h48.test:3001/sa/ar', { waitUntil: 'load', timeout: 90000 }); log('backend DOWN -> storefront http', r.status(), 'offerCards', await page.locator('[data-offer-card]').count(), 'pageerrors', errs.length, 'body text length', (await page.locator('body').innerText()).length);
await b.close();
