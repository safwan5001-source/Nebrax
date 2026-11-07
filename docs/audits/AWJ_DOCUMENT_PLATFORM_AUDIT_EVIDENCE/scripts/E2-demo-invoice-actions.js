// Experiment 2: demo-mode invoice page — actions, thermal print @page behaviour, page.pdf checks
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
function info(f) {
  const i = execSync(`pdfinfo "${f}"`).toString();
  return { pages: /Pages:\s+(\d+)/.exec(i)?.[1], size: /Page size:\s+(.*)/.exec(i)?.[1], text: Number(execSync(`pdftotext "${f}" - | wc -c`).toString()) };
}
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies([{ name: 'locale', value: 'ar', url: BASE }]);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 'demo-user', name: 'demo', email: 'd@x.t', role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant' }));
    window.__printCalls = 0;
    window.print = () => { window.__printCalls++; window.__pageStyle = document.getElementById('nebrax-doc-print-page')?.textContent ?? null;
      window.__target = document.querySelector('[data-print-target]')?.id ?? null; };
  });
  await page.goto(`${BASE}/invoices/inv-118`, { waitUntil: 'commit' }).catch(() => {});
  await page.getByRole('button', { name: /^(Invoice actions|إجراءات الفاتورة)$/ }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'inv118.png'), fullPage: true });
  await page.getByRole('button', { name: /^(Invoice actions|إجراءات الفاتورة)$/ }).click();
  const items = await page.getByRole('menuitem').allInnerTexts();
  console.log('MENU:', JSON.stringify(items));
  fs.writeFileSync(path.join(OUT, 'menu.json'), JSON.stringify(items));
  // click each print-ish item and record @page
  for (const name of items.filter((t) => /طباع|حراري|Print|Thermal|receipt|إيصال/i.test(t))) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^(Invoice actions|إجراءات الفاتورة)$/ }).click();
    await page.getByRole('menuitem', { name }).click();
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => ({ calls: window.__printCalls, style: window.__pageStyle, target: window.__target }));
    console.log('PRINT', name, JSON.stringify(st));
    await page.emulateMedia({ media: 'print' });
    const safe = name.replace(/[^\w]+/g, '_') || 'item';
    const f = path.join(OUT, `print_${safe}.pdf`);
    await page.pdf({ path: f, printBackground: true, preferCSSPageSize: true });
    console.log('  pdf', JSON.stringify(info(f)));
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => { window.__printCalls = 0; document.querySelectorAll('[data-print-target]').forEach((e) => e.removeAttribute('data-print-target')); document.getElementById('nebrax-doc-print-page')?.remove(); });
  }
  await browser.close();
})();
