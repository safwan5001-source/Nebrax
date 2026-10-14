// H1-6A evidence probe: axe `color-contrast` / `link-name` per route across
// UI version (v3, legacy) x colour scheme (light, dark) x viewport.
//
// Usage:
//   PLAYWRIGHT_CORE=<path to playwright-core> CHROMIUM_PATH=<chromium binary> \
//   AXE_PATH=<path to axe-core/axe.min.js> TOKEN=<test-tenant bearer token> \
//   USER_JSON=<file with the /api/me payload> [VW=1440,390] \
//   node axe-contrast-linkname.cjs <base-url> </route,/route> [rule,rule]
//
// Local, non-production test tenant only. Prints one line per violating run and a TOTAL line.
const fs = require('fs');

const need = (name) => {
  if (!process.env[name]) { console.error(`missing env ${name}`); process.exit(2); }
  return process.env[name];
};
const TOKEN = need('TOKEN');
const USER = fs.readFileSync(need('USER_JSON'), 'utf8');
const AXE = fs.readFileSync(need('AXE_PATH'), 'utf8');
const [base, routeArg, ruleArg] = process.argv.slice(2);
if (!base || !routeArg) { console.error('usage: <base-url> <routes> [rules]'); process.exit(2); }
const routes = routeArg.split(',');
const rules = (ruleArg || 'color-contrast,link-name').split(',');
const viewports = (process.env.VW || '1440,390').split(',').map(Number);

(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const out = [];
  for (const ui of ['3', 'legacy']) for (const scheme of ['light', 'dark']) for (const vw of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, colorScheme: scheme });
    await ctx.addCookies([{ name: 'locale', value: 'ar', url: base }]);
    await ctx.addInitScript(({ t, u, ui, scheme }) => {
      const user = JSON.parse(u);
      user.preferences = { ...user.preferences, theme: scheme };
      localStorage.setItem('token', t);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('theme', scheme);
      if (ui === '3') localStorage.setItem('awj:ui-version', '3'); else localStorage.removeItem('awj:ui-version');
    }, { t: TOKEN, u: USER, ui, scheme });
    const page = await ctx.newPage();
    for (const route of routes) {
      await page.goto(base + route);
      await page.waitForTimeout(2500);
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async (rules) => {
        const r = await axe.run(document, { runOnly: { type: 'rule', values: rules } });
        return {
          dark: document.documentElement.classList.contains('dark'),
          v: r.violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 4).map((x) => `${x.target.join(' ').slice(0, 90)} :: ${(x.any[0]?.message || '').slice(0, 110)}`) })),
        };
      }, rules);
      out.push({ ui, scheme, vw, route, dark: res.dark, v: res.v });
    }
    await ctx.close();
  }
  for (const o of out) for (const v of o.v) console.log(`${o.ui}/${o.scheme}${o.dark ? '(dark)' : ''}/${o.vw} ${o.route} ${v.id}=${v.n}\n   ${v.t.join('\n   ')}`);
  const total = {};
  for (const o of out) for (const v of o.v) total[v.id] = (total[v.id] || 0) + v.n;
  console.log('TOTAL', JSON.stringify(total), 'runs', out.length, 'darkApplied', out.filter((o) => o.dark).length);
  await browser.close();
})();
