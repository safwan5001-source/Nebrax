// CUST-HV V7a — real-Chromium proof of the structural header designs (production `Header` markup + the compiled storefront stylesheet):
//   centered : from 768 px the brand is centred on the row (menu spacer included), search on the start side, actions on the end side;
//   two-row  : from 768 px search drops to a second row spanning the container, brand + actions keep the first;
//   compact  : the utility strip is gone; a legacy compact style is overridden by an explicit standard layout;
//   mobile logo-start : below 768 px the brand follows the menu button (mirrored under RTL); no effect from 768 px;
//   height   : the header grows / shrinks by exactly the preset delta (desktop and phone);
//   logo     : wordmark / image size follows the chosen step;
//   sticky   : `always` stays at the top after scrolling, `off` scrolls away AND the in-page offset collapses; otherwise the offset
//              always clears the real header height (skip link / sticky product gallery land clear of it);
//   border / shadow : none / hairline / medium widths on every band; soft < medium shadows;
//   colour   : a designed background paints the header AND its identity row, the wordmark / links / menu / account icon take the proven
//              (automatic or explicit) colours and clear 4.5:1 against that row; an explicit icon colour reaches every plain icon but not
//              the cart pill (it paints its own surface); text-only / icon-only designs leave the background untouched;
//   on-scroll-up : with the production controller mounted, scrolling down past the header slides it fully out of view, the first upward
//              scroll brings it back, it never leaves while focus is inside it (a Tab into the hidden header reveals it first), it is
//              visible at the top, and the slide has no transition under prefers-reduced-motion;
//   ALL      : no horizontal overflow, no overlap among menu / brand / search / actions, explicit defaults == absent design.
// 6 viewports x AR RTL / EN LTR x wordmark / image logo. `--strip` removes the `[data-hd]` rules from the stylesheet and `--control`
// measures the absent design against every design's expectations (negative controls: both must fail).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   HEADER_PROOF_DIR=<dir> npx vitest run src/components/layout/__tests__/header-proof.render.test.tsx
//   node scripts/header-proof/measure.mjs <dir> [--strip|--control]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");
const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
const esbuild = createRequire(join(root, "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/"))("esbuild");
// the production scroll controller, bundled once for the pages that use it
const controller = esbuild.buildSync({
  entryPoints: [join(root, "scripts/header-proof/mount-scroll-up.tsx")], bundle: true, write: false, format: "iife", platform: "browser",
  jsx: "automatic", alias: { "@": join(root, "src") }, define: { "process.env.NODE_ENV": '"production"' }, absWorkingDir: root,
}).outputFiles[0].text;
const dir = resolve(process.argv[2]);
const strip = process.argv.includes("--strip");
const control = process.argv.includes("--control");
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
let stripped = null;
if (strip) {
  const parsed = postcss.parse(readFileSync(join(dir, "storefront.css"), "utf8"));
  parsed.walkRules((r) => { if (/\[data-hd/.test(r.selector)) r.remove(); });
  stripped = parsed.toString();
}
const designs = JSON.parse(readFileSync(join(dir, "designs.json"), "utf8"));
const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html")).sort((a, b) => (b.startsWith("none.") ? 1 : 0) - (a.startsWith("none.") ? 1 : 0) || a.localeCompare(b));
const violations = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) violations.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const baselines = new Map(); // `${logo}.${dir}@${w}` -> metrics of the absent design

const measure = (page) =>
  page.evaluate(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden";
    const r = (e) => { if (!e || !vis(e)) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const header = document.querySelector("header");
    const identity = [...header.children].find((c) => c.tagName === "DIV" && c.querySelector("[data-search], [data-cart]"));
    const grid = identity.firstElementChild.firstElementChild;
    const utility = [...header.children].find((c) => c.tagName === "DIV" && c !== identity && c.className.includes("bg-store-surface-muted"));
    const rail = header.querySelector("[data-rail]");
    const brand = header.querySelector('a[href="/sa/en"]');
    const cart = [...header.querySelectorAll("[data-cart]")].find(vis);
    const actions = cart ? cart.parentElement : null;
    const img = brand.querySelector("img");
    const word = brand.querySelector("span");
    const main = document.querySelector("main");
    const bw = (e) => (e && vis(e) ? parseFloat(getComputedStyle(e).borderBottomWidth) : null);
    const col = (e) => (e && vis(e) ? getComputedStyle(e).color : null);
    const visFirst = (list) => [...list].find(vis) ?? null;
    const account = visFirst(header.querySelectorAll('a[href$="/account"] svg'));
    const pill = visFirst(header.querySelectorAll("[data-cart-pill]"));
    const cartIcon = visFirst(header.querySelectorAll("[data-cart-icon] svg"));
    const extra = visFirst(header.querySelectorAll("[data-extra-nav]"));
    const menuBtn = visFirst(header.querySelectorAll("[data-menu]"));
    const wrapperStyle = getComputedStyle(document.querySelector("[data-published-theme]"));
    return {
      colour: {
        rowBg: getComputedStyle(identity).backgroundColor, headerBg: getComputedStyle(header).backgroundColor,
        wordmark: word ? col(word) : null, extra: col(extra), menu: col(menuBtn), account: col(account),
        pillSvg: col(pill?.querySelector("svg")), pill: col(pill), cartIcon: col(cartIcon),
        railBg: rail ? getComputedStyle(rail).backgroundColor : null,
        muted: wrapperStyle.getPropertyValue("--hd-muted").trim(),
      },
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      header: r(header), headerPos: getComputedStyle(header).position, shadow: getComputedStyle(header).boxShadow,
      grid: r(grid), menu: r(header.querySelector("[data-menu]")), brand: r(brand), search: r(header.querySelector("[data-search]")), actions: r(actions),
      utility: utility ? r(utility) : null, utilityPresent: !!utility,
      img: img ? r(img) : null, fontSize: word ? parseFloat(getComputedStyle(word).fontSize) : null,
      bIdentity: bw(identity), bRail: bw(rail), bUtility: utility ? bw(utility) : null,
      scrollMargin: parseFloat(getComputedStyle(main).scrollMarginTop), hd: document.querySelector("[data-published-theme]").getAttribute("data-hd") ?? "",
    };
  });

const COLOUR = {
  colBgDark: { bg: "#12372a", fg: "#ffffff" },
  colBgPale: { bg: "#fde68a", fg: "#000000" },
  colBgGrey: { bg: "#777777", fg: "#000000" },
  colRoleBrand: { bg: "#12372a", fg: "#ffffff" },
  colTextIcon: { bg: "#12372a", fg: "#fde68a", icon: "#ffffff" },
  colTextOnly: { bg: null, fg: "#111827" },
  colIconOnly: { bg: null, fg: null, icon: "#b91c1c" },
  colTwoRow: { bg: "#12372a", fg: "#ffffff" },
};
const overlap = (a, b) => a && b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1;

for (const file of files) {
  const [name, logo, rtlOrLtr] = file.replace(".html", "").split(".");
  const isRtl = rtlOrLtr === "rtl";
  for (const [w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const target = control ? file.replace(/^[^.]+/, "none") : file;
    let html = readFileSync(join(dir, "pages", target), "utf8");
    if (stripped) html = html.replace(/<style>[\s\S]*?<\/style>/, `<style>${stripped}</style>`);
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const upDesign = designs[name]?.sticky === "on-scroll-up";
    if (upDesign) await page.addScriptTag({ content: controller });
    const m = await measure(page);
    const tag = `${name}.${logo}.${rtlOrLtr}@${w}`;
    const desktop = w >= 768;
    const key = `${logo}.${rtlOrLtr}@${w}`;
    if (name === "none") baselines.set(key, m);
    const base = baselines.get(key);

    ok(m.overflowX <= 0, `${tag} horizontal overflow ${m.overflowX}`);
    const parts = { menu: m.menu, brand: m.brand, search: m.search, actions: m.actions };
    const names = Object.keys(parts);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
      ok(!overlap(parts[names[i]], parts[names[j]]), `${tag} ${names[i]} overlaps ${names[j]}`);
    const start = (a, b) => (isRtl ? a.l >= b.r - 1 : a.r <= b.l + 1); // a is on the inline-start side of b

    if (name === "centered" || name === "centeredStart" || name === "everything") {
      if (desktop) {
        const gc = (m.grid.l + m.grid.r) / 2;
        ok(near((m.brand.l + m.brand.r) / 2, gc, 1.5), `${tag} brand not centred (${(m.brand.l + m.brand.r) / 2} vs ${gc})`);
        ok(start(m.search, m.brand), `${tag} search not on the start side`);
        ok(start(m.brand, m.actions), `${tag} actions not on the end side`);
        ok(near((m.search.t + m.search.b) / 2, (m.brand.t + m.brand.b) / 2, 3), `${tag} search/brand rows differ`);
      }
    }
    if (name === "twoRow" || name === "twoRowTall") {
      if (desktop) {
        ok(m.search.t >= m.brand.b - 0.5 && m.search.t >= m.actions.b - 0.5, `${tag} search not on a second row`);
        ok(near(m.search.w, m.grid.w, 1.5), `${tag} search does not span the container (${m.search.w} vs ${m.grid.w})`);
        ok(isRtl ? near(m.actions.l, m.grid.l, 2) : near(m.actions.r, m.grid.r, 2), `${tag} actions not at the end edge`);
        if (w >= 1024) ok(isRtl ? near(m.brand.r, m.grid.r, 2) : near(m.brand.l, m.grid.l, 2), `${tag} brand not at the start edge`);
      }
    }
    if (name === "compactLayout") ok(!m.utilityPresent, `${tag} utility strip still rendered`);
    if (name === "none" && desktop) ok(m.utilityPresent && !!m.utility, `${tag} baseline lost its utility strip`);
    if (name === "mobileStart" || name === "centeredStart" || name === "everything") {
      if (!desktop) {
        const gap = isRtl ? m.menu.l - m.brand.r : m.brand.l - m.menu.r;
        ok(gap >= -1 && gap <= 24, `${tag} brand does not follow the menu (gap ${gap})`);
      } else if (name === "mobileStart") {
        ok(near(m.brand.l, base.brand.l, 1) && near(m.header.h, base.header.h, 1), `${tag} mobile layout leaked into desktop`);
      }
    }
    if (name === "heightCompact" || name === "heightTall") {
      const want = (desktop ? { heightCompact: -12, heightTall: 16 } : { heightCompact: -8, heightTall: 8 })[name];
      ok(near(m.header.h - base.header.h, want, 1.5), `${tag} header height delta ${m.header.h - base.header.h}, want ${want}`);
    }
    if (name === "logoXl" || name === "logoSm") {
      const want = logo === "image"
        ? ({ logoXl: desktop ? 64 : 48, logoSm: desktop ? 28 : 24 })[name]
        : ({ logoXl: desktop ? 36 : 30, logoSm: desktop ? 20 : 18 })[name];
      const got = logo === "image" ? m.img.h : m.fontSize;
      ok(near(got, want, 1), `${tag} logo size ${got}, want ${want}`);
      if (name === "logoXl") ok(m.header.h >= base.header.h - 0.5 && m.brand.h <= m.header.h, `${tag} header does not contain the large logo`);
    }
    if (name === "standardExplicit") {
      ok(near(m.header.h, base.header.h, 0.5) && near(m.brand.l, base.brand.l, 0.5) && near(m.brand.t, base.brand.t, 0.5), `${tag} explicit defaults differ from the absent design`);
    }
    if (name === "none") ok(m.hd === "", `${tag} data-hd on an untouched header`);

    // sticky + offset
    const design = designs[name];
    const stickyOff = design?.sticky === "off";
    const stickyUp = design?.sticky === "on-scroll-up";
    if (!stickyUp) await page.evaluate(() => window.scrollTo(0, 800));
    const after = await page.evaluate(() => { const hd = document.querySelector("header").getBoundingClientRect(); return { t: hd.top, b: hd.bottom }; });
    if (stickyUp) {
      const state = () => page.evaluate(() => { const h = document.querySelector("header"); const r = h.getBoundingClientRect(); return { t: r.top, b: r.bottom, hidden: h.hasAttribute("data-header-hidden"), tr: getComputedStyle(h).transitionDuration }; });
      const settle = () => page.waitForTimeout(320);
      ok(m.headerPos === "sticky", `${tag} on-scroll-up header is ${m.headerPos}, want sticky`);
      ok(m.scrollMargin >= m.header.h - 0.5 && m.scrollMargin <= m.header.h + 80, `${tag} offset ${m.scrollMargin} vs header ${m.header.h}`);
      await page.evaluate(() => window.scrollTo(0, 0)); await settle();
      let st = await state();
      ok(near(st.t, 0, 0.5) && !st.hidden, `${tag} header not visible at the top (${st.t})`);
      await page.evaluate(() => window.scrollTo(0, 1200)); await settle();
      st = await state();
      ok(st.hidden && st.b <= 0.5, `${tag} header still on screen after scrolling down (${st.b})`);
      await page.evaluate(() => window.scrollBy(0, -30)); await settle();
      st = await state();
      ok(!st.hidden && near(st.t, 0, 0.5), `${tag} header did not return on the first upward scroll (${st.t})`);
      await page.evaluate(() => window.scrollTo(0, 1500)); await settle();
      st = await state();
      ok(st.hidden, `${tag} header did not hide again`);
      // a keyboard user tabbing into the hidden header reveals it first, and it then stays while they work inside it
      await page.evaluate(() => document.querySelector("[data-search-input]").focus()); await settle();
      st = await state();
      ok(!st.hidden && near(st.t, 0, 0.5), `${tag} focus inside did not reveal the header`);
      await page.evaluate(() => window.scrollTo(0, 1800)); await settle();
      st = await state();
      ok(!st.hidden && near(st.t, 0, 0.5), `${tag} header left while focus is inside it`);
      await page.evaluate(() => document.activeElement.blur()); await page.evaluate(() => window.scrollTo(0, 2100)); await settle();
      st = await state();
      ok(st.hidden, `${tag} header did not hide after focus left`);
      ok(parseFloat(st.tr) > 0, `${tag} no slide transition (${st.tr})`);
      await page.emulateMedia({ reducedMotion: "reduce" });
      st = await state();
      ok(parseFloat(st.tr) === 0, `${tag} transition under prefers-reduced-motion (${st.tr})`);
      await page.emulateMedia({ reducedMotion: "no-preference" });
    } else if (stickyOff) {
      ok(after.b <= 0, `${tag} header still on screen after scrolling (sticky off)`);
      ok(m.scrollMargin <= 0.5, `${tag} sticky-off offset ${m.scrollMargin}, want 0`);
    } else if (!stickyUp) {
      ok(near(after.t, 0, 0.5), `${tag} header left the top (${after.t})`);
      ok(m.scrollMargin >= m.header.h - 0.5, `${tag} offset ${m.scrollMargin} does not clear the header (${m.header.h})`);
      ok(m.scrollMargin <= m.header.h + 80, `${tag} offset ${m.scrollMargin} is absurdly larger than the header (${m.header.h})`);
    }

    // borders + shadow
    const wantBorder = { none: 0, medium: 2 }[design?.border?.width] ?? 1;
    for (const [band, v] of [["identity", m.bIdentity], ["rail", m.bRail], ["utility", m.bUtility]]) {
      if (v === null) continue;
      ok(near(v, wantBorder, 0.01), `${tag} ${band} border ${v}px, want ${wantBorder}px`);
    }
    if (design?.shadow === "soft" || design?.shadow === "medium") {
      ok(m.shadow !== "none", `${tag} no shadow`);
      const blurs = [...m.shadow.matchAll(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/g)].map((x) => parseFloat(x[3]));
      const max = Math.max(0, ...blurs);
      if (design.shadow === "soft") ok(max > 0 && max <= 4, `${tag} soft shadow blur ${max}`);
      else ok(max >= 20, `${tag} medium shadow blur ${max}`);
    } else ok(m.shadow === "none", `${tag} unexpected shadow ${m.shadow}`);

    // colour
    const c = m.colour;
    const rgb = (str) => { const x = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(str ?? ""); return x ? [+x[1], +x[2], +x[3]] : null; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const same = (got, want) => { const g = rgb(got); return !!g && g.every((v, i) => v === want[i]); };
    const spec = COLOUR[name];
    const themeBg = [255, 255, 255];
    const themePrimary = hex("#12372a");
    if (spec) {
      const bg = spec.bg ? hex(spec.bg) : null;
      if (bg) {
        ok(same(c.rowBg, bg), `${tag} identity row background ${c.rowBg}, want ${spec.bg}`);
        ok(same(c.headerBg, bg), `${tag} header background ${c.headerBg}, want ${spec.bg}`);
      } else {
        ok(!rgb(c.rowBg) || c.rowBg === "rgba(0, 0, 0, 0)", `${tag} background changed without a designed one: ${c.rowBg}`);
      }
      const surface = bg ?? themeBg;
      const wantFg = spec.fg ? hex(spec.fg) : null;
      const plain = [["extra link", c.extra], ["menu", c.menu]];
      if (logo === "word") plain.push(["wordmark", c.wordmark]);
      for (const [label, got] of plain) {
        if (got === null) continue;
        if (wantFg) ok(label === "extra link" || same(got, wantFg), `${tag} ${label} colour ${got}, want ${spec.fg}`);
        if (spec.fg || spec.bg) ok(cr(rgb(got), surface) >= 4.5, `${tag} ${label} ${got} on the row is ${cr(rgb(got), surface).toFixed(2)}:1`);
      }
      if (c.extra && c.muted) ok(same(c.extra, hex(c.muted)), `${tag} secondary text ${c.extra}, want ${c.muted}`);
      const wantIcon = spec.icon ? hex(spec.icon) : wantFg;
      if (c.account && wantIcon) {
        ok(same(c.account, wantIcon), `${tag} account icon ${c.account}, want ${spec.icon ?? spec.fg}`);
        ok(cr(rgb(c.account), surface) >= 4.5, `${tag} account icon on the row is ${cr(rgb(c.account), surface).toFixed(2)}:1`);
      }
      if (c.cartIcon && wantIcon) ok(same(c.cartIcon, wantIcon), `${tag} cart icon ${c.cartIcon}, want ${spec.icon ?? spec.fg}`);
      // the cart pill paints its own soft surface: neither a header text nor an icon colour may reach it
      if (c.pillSvg && c.pill) ok(c.pillSvg === c.pill && same(c.pill, themePrimary), `${tag} cart pill icon ${c.pillSvg} / text ${c.pill} were recoloured`);
    } else if (!design?.surface && !design?.text && !design?.icon) {
      ok(c.rowBg === "rgba(0, 0, 0, 0)" || same(c.rowBg, themeBg), `${tag} row background ${c.rowBg} on a design without colours`);
      if (logo === "word" && c.wordmark) ok(same(c.wordmark, themePrimary), `${tag} wordmark recoloured without a colour design: ${c.wordmark}`);
    }
    await ctx.close();
  }
}
await browser.close();
const mode = strip ? "STRIPPED (negative control)" : control ? "CONTROL (negative control)" : "production";
console.log(`${mode}: ${files.length} pages x ${viewports.length} viewports, ${checks} checks, ${violations.length} violations`);
for (const v of violations.slice(0, 40)) console.log("  ✗", v);
if (violations.length > 40) console.log(`  … ${violations.length - 40} more`);
process.exit(strip || control ? (violations.length > 0 ? 0 : 1) : violations.length > 0 ? 1 : 0);
