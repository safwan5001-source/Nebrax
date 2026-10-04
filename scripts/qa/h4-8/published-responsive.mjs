import { browser, OUT, log } from './lib.mjs';
import { execSync } from 'node:child_process';
const clearLimit = () => execSync('cd /home/user/nibras-app && php artisan cache:clear', { stdio: 'ignore' }); // QA only: public unauth limit is 30/min/IP
const b = await browser(['--host-resolver-rules=MAP *.h48.test 127.0.0.1']);
for (const [loc, widths] of [['ar', [390, 430, 768, 1024, 1280, 1440]], ['en', [390, 1440]]]) {
  for (const w of widths) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    clearLimit();
    const page = await ctx.newPage();
    await page.goto(`http://a.h48.test:3001/sa/${loc}`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForSelector('[data-offer-card]', { timeout: 5000 }).catch(() => {});
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    const sec = page.locator('section[aria-labelledby]').filter({ has: page.locator('[data-offer-card]') });
    const n = await sec.count();
    const o = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir }));
    const info = n ? await sec.first().evaluate((s) => { const h = document.getElementById(s.getAttribute('aria-labelledby')); return { heading: h?.textContent, cards: s.querySelectorAll('[data-offer-card]').length, imgAlt: [...s.querySelectorAll('img')].map(i => i.getAttribute('alt')), cardLinks: [...s.querySelectorAll('[data-offer-card] a, a[data-offer-card]')].length }; }) : null;
    if (n) { await sec.first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/p-${loc}-${w}.png` }); }
    log(`${loc} ${w}`, 'offerSections', n, 'docOverflow', o.over, 'dir', o.dir, JSON.stringify(info));
    await ctx.close();
  }
}
await b.close();
