import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:3000';
const token = fs.readFileSync('/tmp/qa-token.txt', 'utf8').trim();
const PAGES = ['/partners', '/invoices', '/warehouses', '/products', '/products/import'];
const out = [];
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' });
await context.addCookies([{ name: 'locale', value: 'ar', url: BASE }]);
await context.addInitScript((t) => {
  localStorage.setItem('token', t);
  localStorage.setItem('user', JSON.stringify({ name: 'QA', role: 'owner' }));
}, token);
const page = await context.newPage();
for (const route of PAGES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => {
    const unlabelled = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.type === 'hidden') continue;
      const id = el.getAttribute('id');
      const ok = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label')
        || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
      if (!ok) unlabelled.push(el.getAttribute('placeholder') || el.className.slice(0, 30));
    }
    let small = 0, total = 0;
    for (const el of document.querySelectorAll('button, a[href], input[type=checkbox], input[type=radio], select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      total++;
      const box = el.closest('label') ?? el;
      if (Math.max(r.height, box.getBoundingClientRect().height) < 40) small++;
    }
    return { unlabelled, small, total, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             onLogin: location.pathname.includes('login') };
  });
  out.push({ route, ...s });
  console.log(`${route}  login=${s.onLogin}  unlabelled=${s.unlabelled.length} [${s.unlabelled.join(' | ')}]  under40=${s.small}/${s.total}  overflow=${s.overflow}`);
}
await browser.close();
fs.writeFileSync('/tmp/qa/baseline.json', JSON.stringify(out, null, 2));
