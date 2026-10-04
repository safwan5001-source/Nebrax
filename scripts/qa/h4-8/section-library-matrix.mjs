import { browser, login, WEB, log } from './lib.mjs';
const b = await browser(); const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(); await login(page);
await page.goto(`${WEB}/commerce/appearance`); await page.waitForSelector('[data-experience-builder]', { timeout: 60000 }); await page.waitForTimeout(3500);
await page.getByRole('button', { name: /الصفحة الرئيسية/ }).first().click().catch(()=>{}); await page.waitForTimeout(500);
await page.locator('[data-add-section]').click(); await page.waitForTimeout(500);
log(await page.locator('[data-picker-option]').evaluateAll(els => els.map(e => `${e.getAttribute('data-picker-option').padEnd(14)} ${e.disabled ? 'DISABLED' : 'addable '}  ${e.innerText.replace(/\n/g,' | ').slice(0,100)}`).join('\n')));
log('stale gated/coming-soon text in picker:', /قريباً|قيد التجهيز|Coming soon/i.test(await page.locator('body').innerText()));
await b.close();
