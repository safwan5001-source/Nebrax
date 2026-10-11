// CUST-HV V7c-2 — real-Chromium proof of overlay-on-hero (production Header + production HeroSection + production decision):
//   eligible page (opted in, first visible section a proven full-picture hero, layout not split):
//     * the header takes no height; the hero starts at the very top and its picture reaches BOTH viewport edges;
//     * the hero's content starts below the header's bands (the first heading and the first button are never under it);
//     * `--hd-block` (the controller's measurement) equals the bands' real height;
//     * at scroll 0 the bands are transparent and every text / icon is the proven colour — and the PIXEL proof: with text and
//       borders hidden, the pixels actually painted behind the bands clear 4.5:1 against that colour (the negative control `ovLie`
//       declares bounds the picture does not honour: the pixel proof must FAIL there);
//     * past the scroll threshold, or the moment focus enters the header, it turns solid (opaque bands, normal colours, sticky);
//       back at the top it is transparent again; an on-scroll-up header leaves the screen entirely and returns solid;
//     * without the controller (no JavaScript) it is not sticky: it scrolls away with the hero, never sitting over later content;
//   ineligible page (opted out, picture unprovable / absent / split, hero not first, wide-range or mid-tone picture):
//     * nothing changes: the header keeps its height, its bands are opaque, the hero stays a contained card;
//   ALL: no horizontal overflow; the production decision (sidecar) equals the table below.
// 6 viewports x AR RTL / EN LTR. `--strip` removes the overlay rules from the stylesheet (negative control: must fail).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   HEADER_OVERLAY_PROOF_DIR=<dir> npx vitest run src/components/layout/__tests__/header-overlay-proof.render.test.tsx
//   node scripts/header-proof/measure-overlay.mjs <dir> [--strip]   (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");
const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
const esbuild = createRequire(join(root, "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/"))("esbuild");
const controller = esbuild.buildSync({
  entryPoints: [join(root, "scripts/header-proof/mount-overlay.tsx")], bundle: true, write: false, format: "iife", platform: "browser",
  jsx: "automatic", alias: { "@": join(root, "src") }, define: { "process.env.NODE_ENV": '"production"' }, absWorkingDir: root,
}).outputFiles[0].text;
const dir = resolve(process.argv[2]);
const strip = process.argv.includes("--strip");
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const scenarios = JSON.parse(readFileSync(join(dir, "scenarios.json"), "utf8"));
let stripped = null;
if (strip) {
  const parsed = postcss.parse(readFileSync(join(dir, "storefront.css"), "utf8"));
  parsed.walkRules((r) => { if (/\[data-ho|\[data-header-solid|\[data-header-live|\[data-hd~="?hmo/.test(r.selector)) r.remove(); });
  stripped = parsed.toString();
}
const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html")).sort();
const violations = [];
let checks = 0, pixelChecks = 0;
const ok = (cond, msg) => { checks++; if (!cond) violations.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rgb = (str) => { const x = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(str ?? ""); return x ? [+x[1], +x[2], +x[3], x[4] === undefined ? 1 : +x[4]] : null; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const same = (got, want) => { const g = rgb(got); return !!g && g.slice(0, 3).every((v, i) => v === want[i]); };
const transparent = (str) => { const g = rgb(str); return !!g && g[3] === 0; };

const measure = (page) => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
  const r = (e) => { if (!e || !vis(e)) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const header = document.querySelector("header");
  const bands = [...header.children].filter((c) => c.matches("div, nav") && vis(c));
  const rects = bands.map((b) => b.getBoundingClientRect());
  const wrapper = document.querySelector("[data-published-theme]");
  const marked = document.querySelector("[data-ho]");
  const frame = marked ?? document.querySelector('[data-design-type="hero"]') ?? document.querySelector("main section")?.parentElement;
  const section = (frame?.querySelector("section")) ?? document.querySelector("main section");
  const backdrop = frame?.querySelector("[data-sd-backdrop]");
  const row = header.querySelector("[data-header-row]");
  const brand = header.querySelector("[data-header-brand]");
  const extra = [...header.querySelectorAll("[data-extra-nav]")].find(vis);
  const menuSvg = [...header.querySelectorAll("[data-menu] svg")].find(vis);
  const accountSvg = [...header.querySelectorAll('a[href$="/account"] svg')].find(vis);
  const pill = [...header.querySelectorAll("[data-cart-pill]")].find(vis);
  const col = (e) => (e ? getComputedStyle(e).color : null);
  const h1 = document.querySelector("main h1");
  const cta = document.querySelector("main a[data-hero-cta]");
  const utility = [...header.children].find((c) => c.matches("div") && c !== row && c.className.includes("bg-store-surface-muted"));
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vw: document.documentElement.clientWidth,
    headerBg: getComputedStyle(header).backgroundColor,
    header: r(header), headerPos: getComputedStyle(header).position, live: header.hasAttribute("data-header-live"), solid: header.hasAttribute("data-header-solid"),
    block: rects.length ? { t: Math.min(...rects.map((x) => x.top)), b: Math.max(...rects.map((x) => x.bottom)) } : null,
    hdBlock: parseFloat(wrapper.style.getPropertyValue("--hd-block")) || null,
    marker: marked ? marked.getAttribute("data-ho") : null,
    section: r(section), backdrop: r(backdrop), sectionPad: section ? parseFloat(getComputedStyle(section).paddingTop) : null, sectionRadius: section ? getComputedStyle(section).borderTopLeftRadius : null,
    h1: r(h1), cta: r(cta),
    bg: { row: row ? getComputedStyle(row).backgroundColor : null, utility: utility ? getComputedStyle(utility).backgroundColor : null, rail: (() => { const n = header.querySelector("[data-rail]"); return n && vis(n) ? getComputedStyle(n).backgroundColor : null; })() },
    border: row ? getComputedStyle(row).borderBottomColor : null,
    colour: { brand: col(brand), extra: col(extra), menu: col(menuSvg), account: col(accountSvg), pill: col(pill) },
    hidden: header.hasAttribute("data-header-hidden"),
    containerPad: marked?.parentElement ? getComputedStyle(marked.parentElement).paddingTop : null,
  };
});

// worst contrast between a colour and every sampled pixel of a PNG, decoded in the page
const worstAgainst = (page, dataUrl, fgHex) => page.evaluate(async ({ dataUrl, fgHex }) => {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  const n = parseInt(fgHex.slice(1), 16); const L = lum((n >> 16) & 255, (n >> 8) & 255, n & 255);
  let worst = Infinity;
  for (let i = 0; i < d.length; i += 8) { const P = lum(d[i], d[i + 1], d[i + 2]); const [hi, lo] = L > P ? [L, P] : [P, L]; worst = Math.min(worst, (hi + 0.05) / (lo + 0.05)); }
  return worst;
}, { dataUrl, fgHex });

for (const file of files.filter((f) => f.endsWith(".html"))) {
  const [name, dirName] = file.replace(".html", "").split(".");
  const isRtl = dirName === "rtl";
  const sc = scenarios[name];
  const decision = JSON.parse(readFileSync(join(dir, "pages", `${name}.${dirName}.decision.json`), "utf8"));
  ok((decision !== null) === sc.expectOverlay, `${name}.${dirName} production decision ${JSON.stringify(decision)} vs expected overlay=${sc.expectOverlay}`);
  if (sc.expectOverlay && sc.expectFg) ok(decision?.fg === sc.expectFg, `${name}.${dirName} fg ${decision?.fg}, want ${sc.expectFg}`);
  const up = sc.header.sticky === "on-scroll-up";
  const stickyOn = sc.header.sticky !== "off";

  for (const [w, h] of viewports) {
    const tag = `${name}.${dirName}@${w}`;
    const load = async (withJs) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      // a real file URL (not setContent): the pictures are sibling files and about:blank may not load them
      let target = join(dir, "pages", file);
      if (stripped) {
        mkdirSync(join(dir, "pages-strip"), { recursive: true });
        target = join(dir, "pages-strip", file);
        writeFileSync(target, readFileSync(join(dir, "pages", file), "utf8").replace(/<style>[\s\S]*?<\/style>/, `<style>${stripped}</style>`));
      }
      await page.goto(`file://${target}`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      if (withJs) {
        await page.addScriptTag({ content: `window.__PROOF=${JSON.stringify({ sticky: stickyOn, up })};` });
        await page.addScriptTag({ content: controller });
        await page.waitForTimeout(150);
      }
      return { ctx, page };
    };
    const { ctx, page } = await load(true);
    const m = await measure(page);
    ok(m.overflowX <= 0.5, `${tag} horizontal overflow ${m.overflowX}`);

    if (sc.expectOverlay) {
      ok(m.marker !== null && m.marker.startsWith("on"), `${tag} hero lacks the overlay marker (${m.marker})`);
      ok(near(m.header.h, 0, 0.5), `${tag} header still takes ${m.header.h}px`);
      ok(m.live === stickyOn, `${tag} data-header-live=${m.live}, want ${stickyOn}`);
      ok(m.headerPos === (stickyOn ? "sticky" : "relative"), `${tag} header position ${m.headerPos}`);
      ok(near(m.section.t, m.header.t, 0.5) && near(m.backdrop.t, m.header.t, 0.5), `${tag} hero not flush with the top (hero ${m.section.t}, backdrop ${m.backdrop.t}, header ${m.header.t})`);
      ok(m.backdrop.l <= 0.5 && m.backdrop.r >= m.vw - 0.5, `${tag} picture does not reach both edges (${m.backdrop.l}..${m.backdrop.r} of ${m.vw})`);
      ok(m.sectionRadius === "0px", `${tag} bleeding hero keeps a radius ${m.sectionRadius}`);
      ok(near(m.containerPad ? parseFloat(m.containerPad) : 0, 0, 0.5), `${tag} container still pads the top (${m.containerPad})`);
      ok(m.h1.t >= m.block.b - 0.5, `${tag} heading under the header (${m.h1.t} < ${m.block.b})`);
      ok(m.cta.t >= m.block.b - 0.5, `${tag} first button under the header (${m.cta.t} < ${m.block.b})`);
      ok(m.hdBlock !== null && near(m.hdBlock, m.block.b - m.block.t, 1.5), `${tag} --hd-block ${m.hdBlock} vs bands ${m.block.b - m.block.t}`);
      ok(near(m.sectionPad, m.hdBlock, 1.5), `${tag} hero reserves ${m.sectionPad}px, header is ${m.hdBlock}px`);
      ok(!m.solid, `${tag} solid at the top`);
      const fg = sc.expectFg ?? decision.fg;
      const want = hex(fg);
      for (const [label, got] of [["wordmark", m.colour.brand], ["extra link", m.colour.extra], ["menu icon", m.colour.menu], ["account icon", m.colour.account]]) {
        if (got) ok(same(got, want), `${tag} ${label} ${got}, want ${fg}`);
      }
      for (const [label, got] of [["row", m.bg.row], ["utility", m.bg.utility], ["rail", m.bg.rail]]) {
        if (got) ok(transparent(got), `${tag} ${label} band not transparent at the top: ${got}`);
      }
      ok(transparent(m.border), `${tag} row border visible over the picture: ${m.border}`);
      if (m.colour.pill) ok(same(m.colour.pill, hex("#12372a")), `${tag} cart pill recoloured ${m.colour.pill}`);

      // PIXEL proof — the real pixels behind the bands, text/borders/own-surface elements hidden, against the proven colour
      const hider = await page.addStyleTag({ content: `header *{color:transparent!important;-webkit-text-fill-color:transparent!important;border-color:transparent!important;caret-color:transparent!important}header svg,header [data-cart-pill],header img{visibility:hidden!important}header input::placeholder{color:transparent!important}` });
      const shot = await page.screenshot({ clip: { x: 0, y: Math.max(0, m.block.t), width: m.vw, height: Math.max(1, Math.min(m.block.b - m.block.t, h - m.block.t)) } });
      const worst = await worstAgainst(page, `data:image/png;base64,${shot.toString("base64")}`, fg);
      pixelChecks++;
      await hider.evaluate((e) => e.remove());
      if (name === "ovLie") ok(worst < 4.5, `${tag} the negative control was NOT caught by the pixel proof (worst ${worst.toFixed(2)})`);
      else ok(worst >= 4.5, `${tag} pixels behind the header give only ${worst.toFixed(2)}:1 against ${fg}`);

      // solid after the threshold / on focus; transparent again at the top
      await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(450);
      let s = await measure(page);
      if (up) {
        ok(s.hidden && s.block.b <= 0.5, `${tag} on-scroll-up header still visible after scrolling down (${s.block.b})`);
        await page.evaluate(() => window.scrollBy(0, -30)); await page.waitForTimeout(450);
        s = await measure(page);
        ok(!s.hidden && near(s.block.t, 0, 0.5), `${tag} on-scroll-up header did not return (${s.block.t})`);
      }
      ok(s.solid, `${tag} not solid after scrolling`);
      for (const [label, got] of [["row", s.bg.row], ["utility", s.bg.utility]]) if (got) ok(rgb(got)[3] === 1, `${tag} ${label} band not opaque once solid: ${got}`);
      if (stickyOn && !up) ok(near(s.block.t, 0, 0.5), `${tag} sticky overlay header left the top (${s.block.t})`);
      if (!stickyOn) ok(s.block.b < 0, `${tag} sticky-off header did not scroll away (${s.block.b})`);
      if (s.colour.brand && !sc.header.surface) ok(same(s.colour.brand, hex("#12372a")), `${tag} solid wordmark ${s.colour.brand}`);
      if (sc.header.surface) ok(same(s.bg.row, hex("#12372a")), `${tag} solid row ignores the designed background: ${s.bg.row}`);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(450);
      s = await measure(page);
      ok(!s.solid && transparent(s.bg.row), `${tag} not transparent again at the top`);
      await page.evaluate(() => document.querySelector("[data-search-input]").focus()); await page.waitForTimeout(450);
      s = await measure(page);
      ok(s.solid && rgb(s.bg.row)[3] === 1, `${tag} focus inside did not make the header solid`);
    } else {
      ok(m.marker === null, `${tag} marker on an ineligible page (${m.marker})`);
      ok(m.header.h > 20, `${tag} ineligible page lost its header height (${m.header.h})`);
      ok(rgb(m.headerBg)[3] === 1, `${tag} header not opaque on an ineligible page: ${m.headerBg}`);
      ok(!m.solid, `${tag} stray solid flag`);
      if (m.backdrop) ok(m.backdrop.l > 0.5 || m.vw <= 0, `${tag} picture bleeds on an ineligible page (${m.backdrop.l})`);
      ok(m.sectionPad === 0 || m.sectionPad === null, `${tag} hero padded on an ineligible page (${m.sectionPad})`);
    }
    await ctx.close();

    // no JavaScript: an overlay header is not sticky and never sits over later content
    if (sc.expectOverlay) {
      const { ctx: c2, page: p2 } = await load(false);
      const n = await measure(p2);
      ok(n.headerPos === "relative" && !n.live, `${tag} (no JS) header ${n.headerPos}, live=${n.live}`);
      ok(near(n.header.h, 0, 0.5) && transparent(n.bg.row), `${tag} (no JS) overlay not applied at the top`);
      await p2.evaluate(() => window.scrollTo(0, 1500));
      const away = await measure(p2);
      ok(away.block.b < 0, `${tag} (no JS) header followed the page over later content (${away.block.b})`);
      await c2.close();
    }
  }
}
await browser.close();
console.log(`${strip ? "STRIPPED (negative control)" : "production"}: ${files.filter((f) => f.endsWith(".html")).length} pages x ${viewports.length} viewports, ${checks} checks (${pixelChecks} pixel proofs), ${violations.length} violations`);
for (const v of violations.slice(0, 120)) console.log("  ✗", v);
if (violations.length > 120) console.log(`  … ${violations.length - 120} more`);
process.exit(strip ? (violations.length > 0 ? 0 : 1) : violations.length > 0 ? 1 : 0);
