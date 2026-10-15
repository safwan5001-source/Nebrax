// Disposable A/B capture + measurement harness for the Core-Dark shell comparison.
// Variant CSS is injected at document start (never written to the app): A = untouched app.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { scanContrast } from './contrast-scan.mjs';

const base = 'http://127.0.0.1:3001';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

// Round 2: C = B-AA improved (active #2D4D91, tuned hover, ring #8FB4FF); M = medium-blue alternative (#1E3A8A).
// INK = the existing Ink theme (reference for identity); A = current Core Dark. Candidates are UNAPPROVED.
// Implementation phase: NO CSS injection — the app renders whatever tokens it ships.
export const VARIANTS = { BEFORE: null, AFTER: null, INK: null };
const EXPECT = { BEFORE: 'rgb(79, 140, 255)', AFTER: process.env.AFTER_BG || 'rgb(30, 58, 138)', INK: 'rgb(14, 26, 49)' };
const cssFor = (tokens) => tokens
  ? `html[data-awj-ui="3"][data-awj-theme="core"].dark{${Object.entries(tokens).map(([k, v]) => `--awj-${k}:${v}`).join(';')}}`
  : '';

const executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

async function newCtx(variant, locale, mode, viewOpts) {
  const ctx = await browser.newContext(viewOpts);
  await ctx.addCookies([{ name: 'locale', value: locale, url: base }]);
  await ctx.addInitScript(([mode, theme]) => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 'demo-user', name: 'مستخدم المعاينة', email: 'demo@nibras.test', role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant' }));
    localStorage.setItem('theme', mode);
    localStorage.setItem('awj:theme', theme);
  }, [mode, variant === 'INK' ? 'ink' : 'core']);
  return ctx;
}
let CURRENT = 'A';
const hexToRgb = (h) => { const m = /^#(..)(..)(..)$/.exec(h); return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`; };
async function go(page, route) {
  await page.goto(`${base}${route}?awj-ui=3`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
  // React hydration strips foreign nodes from <html>, so the preview CSS is added to <head> after hydration.
  const css = cssFor(VARIANTS[CURRENT]);
  if (css) await page.addStyleTag({ content: css });
  await page.waitForTimeout(150);
  const expect = EXPECT[CURRENT];
  const got = await page.evaluate(() => getComputedStyle(document.querySelector('[data-awj-shell="sidebar"]')).backgroundColor);
  if (got !== expect) throw new Error(`variant ${CURRENT} not applied on ${route}: sidebar ${got} != ${expect}`);
}
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

// ---- in-page measurement ----------------------------------------------------------------
const measureInPage = () => {
  const parse = (v) => { const m = v.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (t, b) => { const a = t[3] + b[3] * (1 - t[3]); if (!a) return [0, 0, 0, 0]; const mix = (i) => (t[i] * t[3] + b[i] * b[3] * (1 - t[3])) / a; return [mix(0), mix(1), mix(2), a]; };
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const effBg = (el) => { const st = []; for (let n = el; n; n = n.parentElement) { const bg = parse(getComputedStyle(n).backgroundColor); if (bg[3] > 0) st.push(bg); if (bg[3] === 1) break; } let r = [255, 255, 255, 1]; for (const l of st.reverse()) r = over(l, r); return r; };
  const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
  const q = (s) => document.querySelector(s);
  const one = (label, el, min, useStroke = false, bgOverride = null) => {
    if (!el) return { label, missing: true };
    const cs = getComputedStyle(el);
    const fgv = useStroke ? (cs.stroke && cs.stroke !== 'none' ? cs.stroke : cs.color) : cs.color;
    const bg = bgOverride ? parse(bgOverride) : effBg(el);
    const fg0 = parse(fgv); const fg = over(fg0, bg);
    const r = ratio(fg, bg);
    return { label, fg: hex(fg), bg: hex(bg), ratio: Math.round(r * 100) / 100, min, pass: r + 0.005 >= min };
  };
  const side = '[data-awj-shell="sidebar"]', top = '[data-awj-shell="topbar"]';
  const rows = [
    one('sidebar text · group (normal, muted)', q(`${side} nav button:not([data-awj-shell-active])`), 4.5),
    one('sidebar icon · group (normal)', q(`${side} nav button:not([data-awj-shell-active]) svg`), 3, true),
    one('sidebar text · group/dashboard (selected)', q(`${side} [data-awj-shell-active]`), 4.5),
    one('sidebar icon · selected', q(`${side} [data-awj-shell-active] svg`), 3, true),
    one('sidebar text · leaf (normal)', q(`${side} a[data-awj-apex]:not([aria-current])`), 4.5),
    one('sidebar text · leaf (active — Apex used as text)', q(`${side} a[aria-current="page"]`), 4.5),
    one('sidebar text · section label', q('[data-awj-super-group-label]'), 4.5),
    one('sidebar text · company name', q(`${side} span.truncate`), 4.5),
    one('sidebar wordmark (Apex as text)', q(`${side} span.font-bold.text-primary`), 3),
    one('topbar text · search input', q(`${top} input`), 4.5),
    one('topbar icon · buttons', q(`${top} button svg`), 3, true),
    one('topbar text · user name', [...document.querySelectorAll(`${top} span, ${top} div`)].find((e) => e.children.length === 0 && (e.textContent || '').includes('مستخدم المعاينة')), 4.5),
    one('topbar text · user sub-label (branch)', [...document.querySelectorAll(`${top} span, ${top} div`)].find((e) => e.children.length === 0 && /الفرع الرئيسي|Main branch/i.test(e.textContent || '')), 4.5),
    one('topbar text · notification count badge', [...document.querySelectorAll(`${top} span`)].find((e) => e.children.length === 0 && /^\d+$/.test((e.textContent || '').trim())), 4.5),
  ];
  // placeholder text colour
  const inp = q(`${top} input`);
  if (inp) { const ph = getComputedStyle(inp, '::placeholder').color; const bg = effBg(inp.closest('[data-awj-shell-field]') ?? inp); const fg = over(parse(ph), bg); rows.push({ label: 'topbar text · search placeholder', fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio(fg, bg) * 100) / 100, min: 4.5, pass: ratio(fg, bg) + 0.005 >= 4.5 }); }
  // search field border vs field
  const fld = q(`${top} [data-awj-shell-field]`);
  if (fld) { const cs = getComputedStyle(fld); const bg = parse(cs.backgroundColor); const bd = over(parse(cs.borderTopColor), effBg(fld.parentElement)); const r = ratio(bd, over(bg, effBg(fld.parentElement))); rows.push({ label: 'topbar search · field border vs field', fg: hex(bd), bg: hex(over(bg, effBg(fld.parentElement))), ratio: Math.round(r * 100) / 100, min: 3, pass: r + 0.005 >= 3 }); }
  // Apex rail colour on the active leaf (::before), vs the surface it sits on
  const act = q(`${side} a[aria-current="page"]`);
  if (act) { const rc = getComputedStyle(act, '::before').backgroundColor; const bg = effBg(act); const r = ratio(over(parse(rc), bg), bg); rows.push({ label: 'sidebar Apex rail (active leaf) vs shell', fg: hex(over(parse(rc), bg)), bg: hex(bg), ratio: Math.round(r * 100) / 100, min: 3, pass: r + 0.005 >= 3 }); }
  const actG = q(`${side} nav button[data-awj-shell-active]`) ?? q(`${side} a[data-awj-shell-active]`);
  const shellBg = effBg(q(side));
  const geometry = {
    sidebarBg: getComputedStyle(q(side)).backgroundColor, topbarBg: getComputedStyle(q(top)).backgroundColor,
    deskBg: getComputedStyle(document.body).backgroundColor,
    activePlateBg: actG ? getComputedStyle(actG).backgroundColor : null,
    activePlate_vs_shell: actG ? Math.round(ratio(parse(getComputedStyle(actG).backgroundColor), shellBg) * 100) / 100 : null,
    shell_vs_desk: Math.round(ratio(shellBg, parse(getComputedStyle(document.documentElement).getPropertyValue('--awj-surface-desk').trim().replace(/^#(..)(..)(..)$/, (m,r,g,b)=>`rgb(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)})`))) * 100) / 100,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
  return { rows, geometry };
};

const results = {};
const only = process.argv[3] ? process.argv[3].split(',') : Object.keys(VARIANTS);
for (const variant of only) {
  results[variant] = {};
  CURRENT = variant;
  for (const locale of ['ar', 'en']) {
    // ---------- desktop
    let ctx = await newCtx(variant, locale, 'dark', DESKTOP);
    let page = await ctx.newPage();
    const pre = `${variant}-dark-${locale}-desktop`;
    await go(page, '/dashboard');
    await page.screenshot({ path: `${OUT}/${pre}-dashboard.png` });
    await go(page, '/invoices');
    await page.screenshot({ path: `${OUT}/${pre}-invoices.png` });
    const m = await page.evaluate(measureInPage);
    // hover on a normal group
    const grp = page.locator('[data-awj-shell="sidebar"] nav button:not([data-awj-shell-active])').nth(1);
    await grp.hover(); await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${pre}-hover.png` });
    const hov = await grp.evaluate((el) => { const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor }; });
    // keyboard focus on shell controls (sidebar link then topbar search)
    await page.mouse.move(700, 500);
    await page.locator('[data-awj-shell="sidebar"] nav a').first().focus();
    await page.keyboard.press('Tab'); await page.waitForTimeout(250);
    const foc = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 30), outline: cs.outlineColor, width: cs.outlineWidth, offset: cs.outlineOffset, style: cs.outlineStyle }; });
    await page.screenshot({ path: `${OUT}/${pre}-focus-sidebar.png` });
    await page.locator('[data-awj-shell="topbar"] input').click(); await page.waitForTimeout(250);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(250);
    const focS = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); const fld = el.closest('[data-awj-shell-field]'); return { tag: el.tagName, outline: cs.outlineColor, width: cs.outlineWidth, fieldBorder: fld ? getComputedStyle(fld).borderTopColor : null }; });
    await page.screenshot({ path: `${OUT}/${pre}-focus-search.png` });
    const scanSide = await scanContrast(page, '[data-awj-shell="sidebar"]');
    const scanTop = await scanContrast(page, '[data-awj-shell="topbar"]');
    results[variant][`${locale}-desktop`] = { ...m, hover: hov, focusSidebar: foc, focusSearch: focS, scanSide, scanTop };
    await ctx.close();

    // ---------- mobile
    ctx = await newCtx(variant, locale, 'dark', MOBILE);
    page = await ctx.newPage();
    const mp = `${variant}-dark-${locale}-mobile`;
    await go(page, '/dashboard');
    await page.screenshot({ path: `${OUT}/${mp}-dashboard-closed.png` });
    const btn = page.getByRole('button', { name: locale === 'ar' ? 'القائمة' : 'Menu' }).first();
    await btn.click(); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${mp}-drawer-open.png` });
    const scanDrawer = await scanContrast(page, '[data-awj-shell="sidebar"]');
    const mm = await page.evaluate(measureInPage);
    results[variant][`${locale}-mobile`] = { geometry: mm.geometry, scanDrawer };
    await ctx.close();
  }
  // ---------- overflow matrix (common mobile widths + zoom-equivalent viewports)
  const widths = [[320, 568], [360, 740], [390, 844], [412, 915], [768, 1024], [720, 450], [640, 400], [360, 225]];
  results[variant].overflow = [];
  for (const locale of ['ar', 'en']) {
    for (const [w, h] of widths) {
      const ctx = await newCtx(variant, locale, 'dark', { viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
      const page = await ctx.newPage();
      for (const route of ['/dashboard', '/invoices']) {
        await go(page, route);
        const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        results[variant].overflow.push({ locale, w, h, route, overflowX: o });
      }
      await ctx.close();
    }
  }
}
fs.writeFileSync(`${OUT}/measure-${only.join('+')}.json`, JSON.stringify(results, null, 1));
console.log('done', only.join(','));
await browser.close();
