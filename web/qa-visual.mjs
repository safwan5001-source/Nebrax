import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:3000';
const OUT = '/tmp/qa/shots';
fs.mkdirSync(OUT, { recursive: true });

const token = fs.readFileSync('/tmp/qa-token.txt', 'utf8').trim();
const SIZES = [
  { name: '390-mobile', width: 390, height: 844 },
  { name: '768-tablet', width: 768, height: 1024 },
  { name: '1024-desktop', width: 1024, height: 768 },
  { name: '1440-desktop', width: 1440, height: 900 },
];
const MODES = [
  { name: 'ar-light', locale: 'ar', theme: 'light' },
  { name: 'ar-dark', locale: 'ar', theme: 'dark' },
  { name: 'en-light', locale: 'en', theme: 'light' },
  { name: 'en-dark', locale: 'en', theme: 'dark' },
];

const findings = [];
function note(kind, where, detail) {
  findings.push({ kind, where, detail });
  console.log(`[${kind}] ${where} :: ${detail}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const mode of MODES) {
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      locale: mode.locale === 'ar' ? 'ar-SA' : 'en-US',
      colorScheme: mode.theme,
      deviceScaleFactor: 1,
    });
    await context.addCookies([
      { name: 'locale', value: mode.locale, url: BASE },
    ]);
    await context.addInitScript(
      ({ token, theme }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('theme', theme);
        localStorage.setItem('user', JSON.stringify({ name: 'QA', role: 'owner' }));
      },
      { token, theme: mode.theme }
    );

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    const scenes = [
      { key: 'products', go: async () => { await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' }); } },
      {
        key: 'products-selected',
        go: async () => {
          await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' });
          const boxes = page.locator('input[type=checkbox]');
          if (await boxes.count() > 1) { await boxes.nth(1).check().catch(() => {}); }
        },
      },
      {
        key: 'export-dialog',
        go: async () => {
          await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' });
          const boxes = page.locator('input[type=checkbox]');
          if (await boxes.count() > 1) { await boxes.nth(1).check().catch(() => {}); }
          const btn = page.getByRole('button', { name: mode.locale === 'ar' ? 'تصدير' : 'Export' }).first();
          await btn.click({ timeout: 5000 }).catch(() => note('WARN', `${mode.name}/${size.name}/export-dialog`, 'export button not clickable'));
          await page.waitForTimeout(400);
        },
      },
      { key: 'import-step1', go: async () => { await page.goto(`${BASE}/products/import`, { waitUntil: 'networkidle' }); } },
      {
        key: 'import-flow',
        go: async () => {
          await page.goto(`${BASE}/products/import`, { waitUntil: 'networkidle' });
          await page.setInputFiles('#import-file', '/tmp/qa/wide.csv');
          await page.waitForTimeout(1500);
          // Step 2 (mode) -> pick upsert -> mapping
          const upsert = page.locator('input[name="import-mode"][value="upsert"]');
          if (await upsert.count()) await upsert.check().catch(() => {});
          await page.getByRole('button', { name: mode.locale === 'ar' ? 'التالي' : 'Next' }).click().catch(() => {});
          await page.waitForTimeout(500);
        },
      },
      {
        key: 'import-preview',
        go: async () => {
          await page.goto(`${BASE}/products/import`, { waitUntil: 'networkidle' });
          await page.setInputFiles('#import-file', '/tmp/qa/errors.csv');
          await page.waitForTimeout(1500);
          const next = page.getByRole('button', { name: mode.locale === 'ar' ? 'التالي' : 'Next' });
          for (let i = 0; i < 3; i++) { await next.click().catch(() => {}); await page.waitForTimeout(900); }
        },
      },
    ];

    for (const scene of scenes) {
      await scene.go();
      await page.waitForTimeout(250);

      const where = `${mode.name}/${size.name}/${scene.key}`;

      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      if (overflow.scroll > overflow.client + 1) {
        note('OVERFLOW', where, `scrollWidth ${overflow.scroll} > clientWidth ${overflow.client} (+${overflow.scroll - overflow.client}px)`);
      }

      // Unlabelled interactive controls
      const unlabelled = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('input, select, textarea')) {
          if (el.type === 'hidden') continue;
          const id = el.getAttribute('id');
          const hasLabel = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label')
            || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
          if (!hasLabel) bad.push(el.outerHTML.slice(0, 90));
        }
        return bad;
      });
      if (unlabelled.length) note('UNLABELLED', where, `${unlabelled.length}: ${unlabelled[0]}`);

      // Touch targets below 40px on mobile
      if (size.width <= 430) {
        const small = await page.evaluate(() => {
          const bad = [];
          for (const el of document.querySelectorAll('button, a[href], input[type=checkbox], input[type=radio], select')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const box = el.closest('label') ?? el;
            const b = box.getBoundingClientRect();
            if (Math.max(r.height, b.height) < 40) bad.push(`${el.tagName}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)} h=${Math.round(Math.max(r.height, b.height))}`);
          }
          return bad;
        });
        if (small.length) note('TOUCH', where, `${small.length} under 40px: ${small.slice(0, 3).join(' | ')}`);
      }

      // Arabic leaking into the English interface (chrome only, not seeded data)
      if (mode.locale === 'en') {
        const leak = await page.evaluate(() => {
          const bad = [];
          for (const el of document.querySelectorAll('label, legend, th, button, h1, h2, h3')) {
            const t = (el.textContent || '').trim();
            if (/[؀-ۿ]/.test(t)) bad.push(t.slice(0, 40));
          }
          return bad;
        });
        if (leak.length) note('AR-LEAK', where, `${leak.length}: ${leak.slice(0, 3).join(' | ')}`);
      }

      // Raw hex colours in inline styles
      const rawHex = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('[style]')) {
          const s = el.getAttribute('style') || '';
          if (/#[0-9a-fA-F]{3,8}\b/.test(s)) bad.push(s.slice(0, 60));
        }
        return bad;
      });
      if (rawHex.length) note('RAW-HEX', where, `${rawHex.length}: ${rawHex[0]}`);

      // Legacy currency markers
      const currency = await page.evaluate(() => {
        const t = document.body.innerText;
        const hits = [];
        for (const bad of ['﷼', 'ر.س', 'SAR']) if (t.includes(bad)) hits.push(bad);
        // "ريال" is allowed only as a currency *name*, never as a unit after an amount
        if (/[0-9][\s ]*ريال/.test(t)) hits.push('amount+ريال');
        return hits;
      });
      if (currency.length) note('CURRENCY', where, currency.join(','));

      // بوابة التنفيذ: مع وجود أخطاء مانعة يجب ألّا يبقى إجراء التقدّم مفعّلاً.
      if (scene.key === 'import-preview') {
        const gate = await page.evaluate(() => {
          const dt = [...document.querySelectorAll('dt')].find((d) => /خطأ|Error/i.test(d.textContent || ''));
          const count = dt ? Number((dt.nextElementSibling?.textContent || '0').trim()) : 0;
          const buttons = [...document.querySelectorAll('button')];
          const last = buttons[buttons.length - 1];
          return { count, lastText: last ? (last.textContent || '').trim() : '', lastDisabled: last ? last.disabled : true };
        });
        if (gate.count > 0 && !gate.lastDisabled) {
          note('APPLY-GATE', where, `errors=${gate.count} but trailing action enabled: ${gate.lastText}`);
        }
      }

      await page.screenshot({ path: path.join(OUT, `${mode.name}__${size.name}__${scene.key}.png`), fullPage: false });
    }

    if (consoleErrors.length) {
      note('CONSOLE', `${mode.name}/${size.name}`, `${consoleErrors.length}: ${consoleErrors[0].slice(0, 120)}`);
    }
    await context.close();
  }
}

await browser.close();
fs.writeFileSync('/tmp/qa/findings.json', JSON.stringify(findings, null, 2));
console.log(`\n=== ${findings.length} findings ===`);
