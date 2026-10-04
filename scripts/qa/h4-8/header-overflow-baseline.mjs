import { browser, log } from './lib.mjs';
const b = await browser();
for (const [name, base] of [['baseline f73e5b0 (pre-H4-7)', 'http://127.0.0.1:3003'], ['HEAD 0ac176a', 'http://127.0.0.1:3000']]) {
  for (const w of [768, 1024]) {
    const page = await (await b.newContext({ viewport: { width: w, height: 1000 } })).newPage();
    await page.goto(`${base}/dev/customizer-versions?locale=ar&scenario=single-draft`); await page.waitForSelector('[data-experience-builder]', { timeout: 90000 }); await page.waitForTimeout(1500);
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.getByRole('button', { name: /الصفحة الرئيسية/ }).first().click().catch(() => {}); await page.waitForTimeout(500);
    const ov = () => page.evaluate(() => { const h = document.querySelector('header'); return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, header: h ? h.scrollWidth - h.clientWidth : null }; });
    const clean = await ov();
    const add = page.locator('[data-add-section]'); if (await add.count()) { await add.click(); await page.locator('[data-picker-option="banner"]').click(); }
    else { log('   (no add-section surface at this width)'); }
    await page.waitForTimeout(800);
    log(`${name} @${w}`, 'clean', JSON.stringify(clean), 'dirty+Banner', JSON.stringify(await ov()));
    await page.close();
  }
}
await b.close();
