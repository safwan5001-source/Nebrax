// AWJ-ERP-UI-H2 A2 — screen-state probe (evidence tooling only; local isolated backend, never production).
// For each route it renders the real page in four states and records what the screen does:
//   empty     — an empty tenant (TOKEN_EMPTY / USER_EMPTY)
//   loading   — every page-specific /api GET delayed by DELAY_MS; screenshot taken mid-flight
//   error     — every page-specific /api GET answered 500 (shell endpoints keep working)
//   forbidden — a restricted user (TOKEN_STAFF / USER_STAFF)
// "Shell endpoints" = the /api paths a minimal page (SHELL_ROUTE) requests; everything else on a route is page-specific.
// Usage: node probe-states.cjs <routes.json> <outDir> [states csv=empty,loading,error,forbidden]
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const [, , routesFile, outDir, statesCsv = 'empty,loading,error,forbidden'] = process.argv;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const DELAY_MS = Number(process.env.DELAY_MS ?? 2500);
const SHELL_ROUTE = process.env.SHELL_ROUTE ?? '/whats-new';
const ID = { owner: [process.env.TOKEN, process.env.USER_JSON], empty: [process.env.TOKEN_EMPTY, process.env.USER_EMPTY], staff: [process.env.TOKEN_STAFF, process.env.USER_STAFF] };
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
const outFile = path.join(outDir, 'states.jsonl');
const done = new Set();
try { for (const l of fs.readFileSync(outFile, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); done.add(r.state + ' ' + r.route); } } catch {}

const slug = (r) => r.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_') || 'root';
const apiPath = (u) => { try { return new URL(u).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'); } catch { return u; } };

async function context(browser, who) {
  const [token, user] = ID[who];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await ctx.addCookies([{ name: 'locale', value: 'ar', url: BASE }]);
  await ctx.addInitScript(({ token, user }) => {
    try {
      localStorage.setItem('token', token);
      const u = JSON.parse(user); u.preferences = { ...(u.preferences || {}), locale: 'ar', theme: 'light' };
      localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('theme', 'light'); localStorage.setItem('awj:ui-version', '3');
    } catch {}
  }, { token, user });
  return ctx;
}

// What the screen shows, read from the DOM — the reviewer still looks at every screenshot.
async function read(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText;
    const main = document.querySelector('main') || document.body;
    const mainTxt = main.innerText.trim();
    return {
      skeleton: !!main.querySelector('[data-skeleton],[aria-busy="true"],.animate-pulse,[class*="skeleton"]'),
      spinner: !!main.querySelector('.animate-spin,[role="progressbar"]'),
      retry: [...main.querySelectorAll('button')].some((b) => /إعادة المحاولة|حاول مجدد|Retry|Try again/i.test(b.textContent || '')),
      errorText: /(حدث خطأ|تعذّر|تعذر|خطأ في|Something went wrong|Failed|Unable to|Error)/i.test(mainTxt),
      forbiddenText: /(لا تملك|غير مصرح|ليست لديك|صلاحية|Forbidden|not allowed|permission)/i.test(mainTxt),
      emptyText: /(لا توجد|لا يوجد|لم ت|ابدأ ب|فارغ|No .* yet|Nothing|empty|Get started)/i.test(mainTxt),
      ctaInMain: [...main.querySelectorAll('a[href],button')].filter((e) => e.getClientRects().length && /(جديد|إضافة|إنشاء|أضف|New|Add|Create)/.test(e.textContent || '')).length,
      rawZero: /(^|\s)(0\.00|NaN|undefined|null|Invalid Date)(\s|$)/.test(mainTxt),
      mainChars: mainTxt.length,
      h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 80),
      excerpt: mainTxt.replace(/\s+/g, ' ').slice(0, 280),
      toast: [...document.querySelectorAll('[role="status"],[role="alert"]')].map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 3),
      url: location.pathname,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  // Learn the shell endpoints once.
  const shell = new Set();
  { const ctx = await context(browser, 'owner'); const p = await ctx.newPage();
    p.on('request', (r) => { if (r.url().includes('/api/')) shell.add(apiPath(r.url())); });
    await p.goto(BASE + SHELL_ROUTE, { waitUntil: 'domcontentloaded' }); await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await ctx.close(); }
  fs.writeFileSync(path.join(outDir, 'shell-endpoints.json'), JSON.stringify([...shell].sort(), null, 1));
  const isPageApi = (u) => u.includes('/api/') && !shell.has(apiPath(u));

  for (const state of statesCsv.split(',')) {
    const who = state === 'empty' ? 'empty' : state === 'forbidden' ? 'staff' : 'owner';
    const ctx = await context(browser, who);
    const page = await ctx.newPage();
    if (state === 'loading') await page.route('**/api/**', async (r) => { if (r.request().method() === 'GET' && isPageApi(r.request().url())) await new Promise((res) => setTimeout(res, DELAY_MS)); await r.continue().catch(() => {}); });
    if (state === 'error') await page.route('**/api/**', async (r) => { if (r.request().method() === 'GET' && isPageApi(r.request().url())) return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server Error' }) }); await r.continue().catch(() => {}); });
    for (const route of routes) {
      if (done.has(state + ' ' + route)) continue;
      const api = []; const errs = [];
      const onResp = (r) => { if (r.url().includes('/api/') && isPageApi(r.url())) api.push(`${r.status()} ${r.request().method()} ${apiPath(r.url())}`); };
      const onErr = (e) => errs.push(String(e.message).slice(0, 160));
      page.on('response', onResp); page.on('pageerror', onErr);
      let rec = { state, route };
      try {
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (state === 'loading') { await page.waitForTimeout(700); rec.mid = await read(page); await page.screenshot({ path: path.join(outDir, 'shots', `loading__${slug(route)}.png`) }); }
        await page.waitForLoadState('networkidle', { timeout: state === 'loading' ? DELAY_MS + 6000 : 6000 }).catch(() => {});
        await page.waitForTimeout(500);
        rec.end = await read(page);
        if (state !== 'loading') await page.screenshot({ path: path.join(outDir, 'shots', `${state}__${slug(route)}.png`) });
      } catch (e) { rec.navErr = String(e.message).slice(0, 160); }
      rec.pageApi = [...new Set(api)].slice(0, 10); rec.pageErrors = [...new Set(errs)].slice(0, 5);
      fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
      page.off('response', onResp); page.off('pageerror', onErr);
      process.stdout.write(`${state} ${route} ${rec.navErr ? 'NAVERR' : 'ok'}\n`);
    }
    await ctx.close();
  }
  await browser.close();
})();
