import { browser, login, WEB, OUT, SEED, log } from './lib.mjs';
const widths = (process.env.W ?? '390,430,768,1024,1280,1440').split(',').map(Number);
const locales = (process.env.LOCALES ?? 'ar').split(',');
const b = await browser();
const results = [];
for (const locale of locales) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page);
  await ctx.addCookies([{ name: 'locale', value: locale, url: WEB }]);
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 600 ? 844 : 1000 });
    await page.goto(`${WEB}/commerce/appearance`); await page.waitForSelector('[data-experience-builder]', { timeout: 60000 }); await page.waitForTimeout(3500);
    const ov = async () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    const clean = await ov();
    // open Home composer if needed
    await page.getByRole('button', { name: /الصفحة الرئيسية|Home page|Homepage/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    const sec = page.locator('[data-composer-section="offers"]').nth(1);
    let selected = false;
    if (!(await sec.count())) { await page.getByRole('button', { name: /^(الأقسام|Sections)$/ }).click().catch(()=>{}); await page.waitForTimeout(700); const dsec = page.getByRole('dialog').locator('[data-composer-section="offers"]').nth(1); if (await dsec.count()) { await dsec.locator('button:not([aria-label])').first().click(); selected = true; await page.waitForTimeout(900); await page.getByRole('dialog').locator('[data-selected-section-settings="offers"]').scrollIntoViewIfNeeded().catch(()=>{}); } }
    else { await sec.locator('button:not([aria-label])').first().click().catch(() => {}); selected = true; await page.waitForTimeout(800); }
    await page.screenshot({ path: `${OUT}/r-${locale}-${w}-panel.png`, fullPage: false });
    const afterSelect = await ov();
    // dirty the draft: flip the selected section's visibility switch
    const sw = page.locator('[data-selected-section-settings="offers"] [role="switch"]').first();
    if (await sw.count()) await sw.click().catch(() => {});
    await page.waitForTimeout(600);
    const dirty = await ov();
    await page.screenshot({ path: `${OUT}/r-${locale}-${w}-dirty.png`, fullPage: false });
    const header = await page.evaluate(() => { const h = document.querySelector('[data-experience-builder] header, header'); return h ? { sw: h.scrollWidth, cw: h.clientWidth } : null; });
    results.push({ locale, w, selected, clean, afterSelect, dirty, header });
    log(JSON.stringify(results.at(-1)));
  }
  await ctx.close();
}
await b.close();
