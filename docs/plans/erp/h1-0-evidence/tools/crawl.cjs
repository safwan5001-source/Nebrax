// AWJ-ERP-UX-H1-0 real-browser audit crawler (local, non-production data only).
// Usage: node crawl.cjs <routes.json> <outDir> <configs csv> [axe=1] [shots=1]
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const [, , routesFile, outDir, configsCsv, axeFlag = '1', shotFlag = '0'] = process.argv;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const TOKEN = process.env.TOKEN;
const USER = process.env.USER_JSON;
const UI = process.env.UI ?? '3'; // '3' = v3 gate on, 'legacy'
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
const AXE = fs.readFileSync(path.join(__dirname, 'node_modules/axe-core/axe.min.js'), 'utf8');
fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
const outFile = path.join(outDir, 'results.jsonl');
const done = new Set(); try { for (const l of fs.readFileSync(outFile, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); done.add(r.cfg + ' ' + r.route); } } catch {}

const CONFIGS = {
  'ar-light-1440': { locale: 'ar', theme: 'light', width: 1440, height: 900 },
  'en-dark-1440': { locale: 'en', theme: 'dark', width: 1440, height: 900 },
  'ar-light-1280': { locale: 'ar', theme: 'light', width: 1280, height: 800 },
  'ar-light-1024': { locale: 'ar', theme: 'light', width: 1024, height: 768 },
  'ar-light-768': { locale: 'ar', theme: 'light', width: 768, height: 1024 },
  'ar-light-390': { locale: 'ar', theme: 'light', width: 390, height: 844, mobile: true },
  'en-light-390': { locale: 'en', theme: 'light', width: 390, height: 844, mobile: true },
  'ar-dark-360': { locale: 'ar', theme: 'dark', width: 360, height: 780, mobile: true },
  'ar-light-320': { locale: 'ar', theme: 'light', width: 320, height: 640, mobile: true },
};

function slug(route) { return route.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_') || 'root'; }
function normUrl(u) { try { const x = new URL(u); return x.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'); } catch { return u; } }

async function measure(page, mobile) {
  return page.evaluate((mobile) => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const overflowX = Math.max(0, de.scrollWidth - vw);
    const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((e) => e.offsetParent !== null || e.getClientRects().length);
    const levels = h.map((e) => Number(e.tagName[1]));
    let skips = 0; for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips++;
    const h1 = levels.filter((l) => l === 1).length;
    const main = document.querySelectorAll('main,[role=main]').length;
    const skip = !!document.querySelector('a[href="#main"],a[href="#main-content"],a[href^="#"][class*="sr-only"]');
    // raw i18n keys rendered as text (e.g. "invoices.title" or "common.save")
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const rawKeys = new Set(); let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.trim();
      if (/^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){1,5}$/.test(t) && !/\.(com|sa|test|png|jpg|pdf|csv|xlsx|json)$/.test(t)) rawKeys.add(t);
    }
    // interactive targets smaller than 24x24 (WCAG 2.2 SC 2.5.8 minimum), visible only
    const inter = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch]')]
      .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && r.top < innerHeight * 3; });
    const small = inter.filter((e) => { const r = e.getBoundingClientRect(); if (e.tagName === 'A' && getComputedStyle(e).display === 'inline') return false; if (e.type === 'checkbox' || e.type === 'radio') return false; return r.width < 24 || r.height < 24; });
    const smallSamples = small.slice(0, 5).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40));
    // unnamed buttons (no text, no aria-label/labelledby/title)
    const unnamed = [...document.querySelectorAll('button,[role=button],a[href]')].filter((e) => {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const name = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim();
      const lb = e.getAttribute('aria-labelledby');
      const img = e.querySelector('img[alt]:not([alt=""])');
      return !name && !lb && !img;
    }).length;
    // elements whose right/left edge exits viewport (content clipping) — exclude off-canvas fixed nav
    const offscreen = [...document.querySelectorAll('main *')].filter((e) => {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
      return (r.right > vw + 1 || r.left < -1) && !e.closest('[data-scroll-region],.overflow-x-auto,.overflow-auto,[class*="overflow-x"]');
    }).length;
    const tables = document.querySelectorAll('table').length;
    const title = document.title;
    const dir = de.getAttribute('dir'); const lang = de.getAttribute('lang');
    const ui = de.getAttribute('data-awj-ui');
    const bodyText = document.body.innerText.slice(0, 20000);
    const errorState = /(حدث خطأ|تعذّر|تعذر|Something went wrong|Failed to|Unable to|غير مصرح|Forbidden|not found|غير موجود)/i.test(bodyText);
    const h1Text = (document.querySelector('h1')?.textContent || '').trim().slice(0, 80);
    const chrome = [...document.querySelectorAll('th,label,button,h1,h2,h3,[role=tab],nav a,legend,option')].filter((e) => e.getClientRects().length);
    const AR = /[\u0600-\u06FF]/;
    const arabicChrome = [...new Set(chrome.map((e) => (e.textContent || '').trim()).filter((t) => t && AR.test(t)))];
    const arabicPlaceholders = [...document.querySelectorAll('[placeholder]')].map((e) => e.getAttribute('placeholder')).filter((t) => t && AR.test(t));
    const latinChrome = [...new Set(chrome.map((e) => (e.textContent || '').trim()).filter((t) => t && /^[A-Za-z][A-Za-z ]{3,}$/.test(t)))];
    return { arabicChrome: arabicChrome.slice(0, 15), arabicChromeN: arabicChrome.length, arabicPlaceholders: arabicPlaceholders.slice(0, 5), latinChrome: latinChrome.slice(0, 15), latinChromeN: latinChrome.length, vw, overflowX, h1, h1Text, headingSkips: skips, headings: levels.length, main, skip, rawKeys: [...rawKeys].slice(0, 10), small: small.length, smallSamples, unnamed, offscreen, tables, title, dir, lang, ui, errorState };
  }, mobile);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const configs = configsCsv.split(',');
  for (const cfgName of configs) {
    const cfg = CONFIGS[cfgName];
    const ctx = await browser.newContext({ viewport: { width: cfg.width, height: cfg.height }, isMobile: !!cfg.mobile, hasTouch: !!cfg.mobile, deviceScaleFactor: 1, colorScheme: cfg.theme });
    await ctx.addCookies([{ name: 'locale', value: cfg.locale, url: BASE }]);
    await ctx.addInitScript(({ token, user, theme, ui, locale }) => {
      try {
        localStorage.setItem('token', token);
        const u = JSON.parse(user); u.preferences = { ...(u.preferences || {}), locale, theme };
        localStorage.setItem('user', JSON.stringify(u));
        localStorage.setItem('theme', theme);
        if (ui === '3') localStorage.setItem('awj:ui-version', '3'); else localStorage.removeItem('awj:ui-version');
      } catch {}
    }, { token: TOKEN, user: USER, theme: cfg.theme, ui: UI, locale: cfg.locale });
    const page = await ctx.newPage();
    for (const route of routes) {
      if (done.has(cfgName + ' ' + route)) continue;
      const consoleErrors = []; const failed = []; const missing = new Set();
      const onConsole = (m) => {
        const t = m.text();
        if (/MISSING_MESSAGE|IntlError/.test(t)) { const k = t.match(/MISSING_MESSAGE: (?:Could not resolve `)?([^`\s]+)/); missing.add(k ? k[1] : t.slice(0, 120)); return; }
        if (m.type() === 'error') consoleErrors.push(t.slice(0, 200));
      };
      const onResp = (r) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${normUrl(u)}`); };
      const onPageErr = (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200));
      page.on('console', onConsole); page.on('response', onResp); page.on('pageerror', onPageErr);
      // A page (e.g. /settings) may re-apply the account's server-side locale to the cookie; re-assert the run's locale before every load.
      await ctx.addCookies([{ name: 'locale', value: cfg.locale, url: BASE }]);
      const t0 = Date.now(); let status = null; let navErr = null;
      try {
        const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
        status = resp ? resp.status() : null;
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(400);
      } catch (e) { navErr = String(e.message).slice(0, 150); }
      const loadMs = Date.now() - t0;
      let m = {}; let axe = null;
      try { m = await measure(page, !!cfg.mobile); } catch (e) { navErr = navErr ?? String(e.message).slice(0, 150); }
      if (axeFlag === '1' && !navErr) {
        try {
          await page.addScriptTag({ content: AXE });
          axe = await page.evaluate(async () => {
            const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
            return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(' ').slice(0, 120) }));
          });
        } catch (e) { axe = [{ id: 'axe-error', impact: 'n/a', n: 0, sample: String(e.message).slice(0, 100) }]; }
      }
      let shot = null;
      if (shotFlag === '1' && !navErr) {
        shot = `shots/${cfgName}__${slug(route)}.png`;
        await page.screenshot({ path: path.join(outDir, shot), fullPage: false }).catch(() => { shot = null; });
      }
      const finalPath = new URL(page.url()).pathname;
      const rec = { cfg: cfgName, ui: UI, route, finalPath, status, loadMs, navErr, ...m, consoleErrors: [...new Set(consoleErrors)].slice(0, 8), failedApi: [...new Set(failed)].slice(0, 12), missingMessages: [...missing].slice(0, 20), axe, shot };
      fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
      page.off('console', onConsole); page.off('response', onResp); page.off('pageerror', onPageErr);
      process.stdout.write(`${cfgName} ${route} ${status} ox=${m.overflowX} axe=${axe ? axe.length : '-'} ${loadMs}ms\n`);
    }
    await ctx.close();
  }
  await browser.close();
})();
