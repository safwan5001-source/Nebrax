import { browser, login, WEB, OUT, SEED, API, log } from './lib.mjs';
const b = await browser(); const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(); await login(page);
const tok = await page.evaluate(() => localStorage.getItem('token')); const vs = (await (await fetch(`${API}/api/commerce/workspace/storefronts/${SEED.storefrontA}/presentation/versions`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' } })).json()).data; log('versions:', vs.map(v => v.state + ':' + v.name).join(' | ')); const pub = vs.find(v => v.state === 'published');
await page.goto(`${WEB}/commerce/appearance?version=${pub.id}`); await page.waitForSelector('[data-experience-builder]', { timeout: 60000 }); await page.waitForTimeout(5000);
const c = page.locator('[data-preview-canvas]'); const t = await c.innerText();
log('canvas banner:', t.includes('تخفيضات الخريف'), '| benefits:', t.includes('شحن سريع') && t.includes('دفع آمن'), '| custom:', t.includes('عن متجرنا'), '| app promo:', t.includes('متجر QA'));
const feat = c.locator('section').filter({ hasText: 'مختارات المتجر' }); log('canvas featured order:', JSON.stringify(await feat.first().locator('[data-home-featured-card], a, article').evaluateAll(a => a.map(x => x.innerText.split('\n').filter(Boolean)[0]).filter(Boolean).slice(0, 4))));
log('canvas h2 order:', JSON.stringify(await c.locator('h2').allInnerTexts()));
await b.close();
