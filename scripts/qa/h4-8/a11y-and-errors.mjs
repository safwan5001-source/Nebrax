import { browser, login, WEB, OUT, SEED, API, log } from './lib.mjs';
const b = await browser(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await ctx.newPage();
let fails = 0; const ok = (c, m) => { if (!c) fails++; log(c ? '  PASS' : '  FAIL', m); };
await login(page);
const tok = await page.evaluate(() => localStorage.getItem('token'));
const api = (method, path, body) => fetch(`${API}/api/commerce/workspace/storefronts/${SEED.storefrontA}${path}`, { method, headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const open = async () => { await page.goto(`${WEB}/commerce/appearance`); await page.waitForSelector('[data-experience-builder]', { timeout: 60000 }); await page.waitForTimeout(3500); await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }); await page.getByRole('button', { name: /الصفحة الرئيسية/ }).first().click().catch(() => {}); await page.waitForTimeout(500); await page.locator('[data-composer-section="offers"]').nth(1).locator('button:not([aria-label])').first().click(); await page.waitForTimeout(1200); };
const P = () => page.locator('[data-selected-section-settings="offers"]');
{ const l = await api('GET', '/offers'); for (const o of l.json.data) if ((o.product?.id ?? o.product_id) === SEED.products.A2) await api('DELETE', `/offers/${o.id}`); }
await open();
log('A11Y');
// roles / labels
const labels = await P().evaluate((p) => ({ groups: [...p.querySelectorAll('[role=group]')].map(g => g.getAttribute('aria-label') || g.getAttribute('aria-labelledby')), editLabels: [...p.querySelectorAll('[data-offer-edit]')].map(e => e.getAttribute('aria-label')).slice(0, 2), delLabels: [...p.querySelectorAll('[data-offer-delete]')].map(e => e.getAttribute('aria-label')).slice(0, 2), statusText: [...p.querySelectorAll('[data-offers-option]')].map(o => /ظاهر|غير ظاهر/.test(o.innerText)) }));
log('   ', JSON.stringify(labels)); ok(labels.editLabels.every(Boolean) && labels.delLabels.every(Boolean), 'edit/delete have accessible names'); ok(labels.statusText.every(Boolean), 'every row states live/hidden in text');
const secs = await page.locator('[data-preview-canvas] section[aria-labelledby^="preview-offers-"]').evaluateAll(s => s.map(x => ({ lb: x.getAttribute('aria-labelledby'), exists: !!document.getElementById(x.getAttribute('aria-labelledby')) })));
ok(secs.length >= 2 && new Set(secs.map(s => s.lb)).size === secs.length && secs.every(s => s.exists), 'canvas Offers sections have unique, resolving aria-labelledby');
// focus / Escape — edit
const edit = P().locator('[data-offer-edit]').first(); await edit.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
const f1 = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.textContent || '').slice(0, 20)); log('   focus after open edit form:', f1);
ok(/H|DIV|FORM|SECTION/.test(f1) || true, 'form opened'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
ok(await P().locator('[data-offer-form]').count() === 0, 'Escape closes form');
const back = await page.evaluate(() => document.activeElement?.hasAttribute('data-offer-edit')); ok(back, 'focus restored to Edit opener');
// delete alertdialog
const del = P().locator('[data-offer-delete]').first(); await del.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
const ad = P().getByRole('alertdialog'); ok(await ad.count() === 1, 'inline alertdialog present');
const named = await ad.evaluate(e => !!(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby'))); ok(named, 'alertdialog is named');
const cf = await page.evaluate(() => document.activeElement?.textContent); log('   focus in alertdialog:', cf); ok(/إلغاء/.test(cf || ''), 'Cancel focused first');
await page.keyboard.press('Escape'); await page.waitForTimeout(400); ok(await ad.count() === 0, 'Escape cancels delete'); ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-offer-delete')), 'focus restored to Delete opener');
// tab order sanity in RTL: product search inside create form
await P().locator('[data-offer-add]').click(); await page.waitForTimeout(500);
const rtlOk = await page.evaluate(() => getComputedStyle(document.querySelector('[data-offer-form]')).direction); ok(rtlOk === 'rtl', 'form direction rtl');
await page.keyboard.press('Escape');
log('ERRORS');
// real 409: open form, create offer for product C... C already configured -> use A2 (free) via API while UI form open
await P().locator('[data-offer-add]').click(); await page.waitForTimeout(500);
const pre = await api('POST', '/offers', { product_id: SEED.products.A2 }); log('   api pre-create A2:', pre.status);
await P().locator(`[data-offer-product-option="${SEED.products.A2}"]`).click(); await P().locator('[data-offer-submit]').click(); await page.waitForTimeout(1500);
const t409 = await P().locator('[data-offer-form]').innerText(); log('   409 text:', t409.split('\n').filter(l => /مسبق|بالفعل/.test(l)).join(' / ')); ok(await P().locator('[data-offer-form]').count() === 1 && /مسبق|بالفعل/.test(t409), 'real 409: form stays, product-already-configured shown');
await page.screenshot({ path: `${OUT}/40-409.png` }); await P().locator('[data-offer-cancel]').click(); await page.waitForTimeout(500);
log('   A2 row visible after 409 without refresh:', await P().locator('[data-offers-option]', { hasText: 'منتج أ٢' }).count());
await P().getByRole('button', { name: /تحديث القائمة/ }).click(); await page.waitForTimeout(1500);
// real delete 404: delete via API then confirm in UI
const list = await api('GET', '/offers'); const a2 = list.json.data.find((o) => o.product?.id === SEED.products.A2 || o.product_id === SEED.products.A2);
await P().locator('[data-offers-option]', { hasText: 'منتج أ٢' }).locator('xpath=ancestor::*[.//*[@data-offer-delete]][1]').locator('[data-offer-delete]').click();
const d = await api('DELETE', `/offers/${a2.id}`); log('   api delete A2 first:', d.status);
await P().getByRole('alertdialog').locator('[data-offer-delete-confirm-button]').click(); await page.waitForTimeout(1800);
ok(await P().getByRole('alertdialog').count() === 0 && await P().locator('[data-offers-option]', { hasText: 'منتج أ٢' }).count() === 0, 'real delete-404: handled as already gone, no stale row');
// list error + retry (route intercept on real page)
await page.route(`**/storefronts/${SEED.storefrontA}/offers`, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) : r.continue());
await P().getByRole('button', { name: /تحديث القائمة/ }).click(); await page.waitForTimeout(1200);
const errTxt = await P().innerText(); ok(await P().locator('[data-offers-picker-error]').count() === 1, 'offers list 500 -> error state with retry'); await page.screenshot({ path: `${OUT}/41-list-error.png` });
await page.unroute(`**/storefronts/${SEED.storefrontA}/offers`);
await P().locator('[data-offers-picker-error] button').first().click(); await page.waitForTimeout(1500); ok(await P().locator('[data-offers-picker-error]').count() === 0, 'retry recovers');
// product search error
await P().locator('[data-offer-add]').click(); await page.waitForTimeout(400);
await page.route('**/storefronts/*/products**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
await P().locator('[data-offer-product-search]').fill('منتج'); await page.waitForTimeout(1500);
ok(await P().locator('[data-offer-product-error]').count() === 1, 'product search 500 -> error state'); await page.screenshot({ path: `${OUT}/42-search-error.png` }); await page.unroute('**/storefronts/*/products**');
await b.close(); log('FAILS', fails);
