// CUST-HV V7d-3 — real-Chromium proof of the published navigation (production Header markup + the compiled storefront stylesheet +
// the production HeaderNavLinks / MobileNavItem client components, mounted by scripts/nav-proof/mount.tsx):
//   desktop (>= lg) : the nav is visible, the dropdown panel is closed and unreachable until opened; the chevron button opens it with a
//                     click AND with the keyboard (ArrowDown focuses the first child, arrows rove and wrap, Home/End, Escape closes and
//                     returns focus to the button, Tab away closes); a mouse hover opens it and leaving closes it; the panel's inline-start
//                     edge sits on the parent's inline-start edge (left in LTR, right in RTL); it stays inside the viewport, paints over the
//                     page (hit-test), does not change the header's height; plain items keep their order mirrored under RTL; icons are
//                     decorative; badges clear 4.5:1; the new-tab child carries rel=noopener noreferrer;
//   below lg        : the desktop nav is not shown; the accordion toggle is a >= 44 px target, opens / closes the children, children indent
//                     on the logical start side, nothing overflows the viewport.
// 6 viewports x AR RTL / EN LTR. `--strip` removes `position:absolute` (the panel must then change the header height); `--physical` turns the logical `start-0` into a physical `left:0` (RTL alignment must fail).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   NAV_PROOF_DIR=<dir> npx vitest run src/components/layout/__tests__/nav-proof.render.test.tsx
//   node scripts/nav-proof/measure.mjs <dir> [--strip|--physical]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");
const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
const esbuild = createRequire(join(root, "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/"))("esbuild");
const bundle = esbuild.buildSync({
  entryPoints: [join(root, "scripts/nav-proof/mount.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@": join(root, "src"), "next/link": join(root, "scripts/nav-proof/link-shim.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, absWorkingDir: root,
  loader: { ".json": "json" },
}).outputFiles[0].text;
const dir = resolve(process.argv[2]);
const strip = process.argv.includes("--strip") || process.argv.includes("--physical");
const physical = process.argv.includes("--physical");
let css = readFileSync(join(dir, "storefront.css"), "utf8");
if (strip) {
  const parsed = postcss.parse(css);
  // --strip: the panel loses `position:absolute` (it must then push the header taller); --physical: `start-0` becomes a PHYSICAL `left: 0`
  // (the alignment check must then fail under RTL).
  parsed.walkRules((r) => {
    if (physical) { if (/^\.start-0$/.test(r.selector)) r.walkDecls("inset-inline-start", (d) => { d.prop = "left"; }); }
    else if (/^\.absolute$/.test(r.selector)) r.remove();
  });
  css = parsed.toString();
}
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const violations = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) violations.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a]; return (lum(hi) + 0.05) / (lum(lo) + 0.05); };
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

for (const dirName of ["ltr", "rtl"]) {
  const rtl = dirName === "rtl";
  const html = readFileSync(join(dir, "pages", `nav.${dirName}.html`), "utf8").replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`);
  for (const [w, h] of viewports) {
    const tag = `nav.${dirName}@${w}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.addScriptTag({ content: bundle });
    await page.waitForTimeout(150);
    const desktop = w >= 1024;
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok((await overflow()) <= 0.5, `${tag} horizontal overflow`);

    if (desktop) {
      const info = await page.evaluate(() => {
        const nav = document.querySelector("header nav[aria-label]");
        const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
        const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
        const top = [...document.querySelectorAll("header nav a[data-extra-nav]")].filter(vis);
        const dd = document.querySelector("[data-nav-dropdown]");
        const panel = dd?.querySelector("[data-nav-panel]");
        const badges = [...document.querySelectorAll("header [data-nav-badge]")].map((b) => ({ tone: b.dataset.navBadge, fg: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor }));
        return {
          navVisible: vis(nav), navLabel: nav?.getAttribute("aria-label"), count: top.length, centers: top.map((a) => { const b = r(a); return (b.l + b.r) / 2; }),
          panelHidden: panel ? !vis(panel) : null, iconsHidden: [...document.querySelectorAll("header nav svg")].every((s) => s.getAttribute("aria-hidden") === "true"),
          badges, headerH: r(document.querySelector("header")).h, dd: dd ? r(dd) : null,
        };
      });
      ok(info.navVisible, `${tag} desktop nav not visible`);
      ok(info.count === 3, `${tag} expected 3 top-level links, got ${info.count}`);
      ok(rtl ? info.centers[0] > info.centers[1] && info.centers[1] > info.centers[2] : info.centers[0] < info.centers[1] && info.centers[1] < info.centers[2], `${tag} item order not mirrored correctly ${info.centers}`);
      ok(info.panelHidden === true, `${tag} panel visible before opening`);
      ok(info.iconsHidden, `${tag} an icon is exposed to assistive tech`);
      for (const b of info.badges) ok(ratio(rgb(b.fg), rgb(b.bg)) >= 4.5, `${tag} ${b.tone} badge contrast ${ratio(rgb(b.fg), rgb(b.bg)).toFixed(2)}`);

      const button = page.locator("[data-nav-dropdown] button");
      // keyboard open
      await button.focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(80);
      let st = await page.evaluate(() => {
        const dd = document.querySelector("[data-nav-dropdown]");
        const panel = dd.querySelector("[data-nav-panel]");
        const kids = [...panel.querySelectorAll("[data-nav-child]")];
        const b = (e) => e.getBoundingClientRect();
        const first = kids[0];
        const fb = b(first);
        const hit = document.elementFromPoint((fb.left + fb.right) / 2, (fb.top + fb.bottom) / 2);
        const pb = b(panel), db = b(dd);
        return {
          expanded: dd.querySelector("button").getAttribute("aria-expanded"), controls: dd.querySelector("button").getAttribute("aria-controls") === panel.id,
          focusFirst: document.activeElement === first, hit: panel.contains(hit), pl: pb.left, pr: pb.right, dl: db.left, dr: db.right, vw: document.documentElement.clientWidth,
          pt: pb.top, headerBottom: b(document.querySelector("header")).bottom, headerH: b(document.querySelector("header")).height,
          rel: kids[2].getAttribute("rel"), target: kids[2].getAttribute("target"), w: pb.width,
          outline: (() => { first.focus(); const s = getComputedStyle(first); return s.backgroundColor; })(),
        };
      });
      ok(st.expanded === "true" && st.controls, `${tag} ArrowDown did not open (aria ${st.expanded}/${st.controls})`);
      ok(st.focusFirst, `${tag} first child not focused`);
      ok(st.hit, `${tag} panel does not paint over the page (hit-test failed)`);
      ok(st.pl >= -0.5 && st.pr <= st.vw + 0.5, `${tag} panel leaves the viewport (${st.pl}..${st.pr} of ${st.vw})`);
      ok(rtl ? near(st.pr, st.dr, 1.5) : near(st.pl, st.dl, 1.5), `${tag} panel not aligned to the parent's inline-start edge (${rtl ? `panel.r ${st.pr} vs ${st.dr}` : `panel.l ${st.pl} vs ${st.dl}`})`);
      ok(near(st.headerH, info.headerH, 0.5), `${tag} opening the panel changed the header height (${info.headerH} -> ${st.headerH})`);
      ok(st.rel === "noopener noreferrer" && st.target === "_blank", `${tag} new-tab child rel/target ${st.rel}/${st.target}`);
      ok(st.outline !== "rgba(0, 0, 0, 0)", `${tag} focused child shows no focus background`);
      // roving
      const active = () => page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 12));
      await page.keyboard.press("ArrowDown"); const second = await active();
      await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); const wrapped = await active();
      await page.keyboard.press("End"); const end = await active();
      await page.keyboard.press("Home"); const home = await active();
      ok(second !== wrapped, `${tag} arrows did not rove`); ok(wrapped === home, `${tag} ArrowDown did not wrap to the first child`);
      ok(end !== home, `${tag} End/Home identical`);
      await page.keyboard.press("Escape");
      st = await page.evaluate(() => ({ expanded: document.querySelector("[data-nav-dropdown] button").getAttribute("aria-expanded"), onButton: document.activeElement === document.querySelector("[data-nav-dropdown] button") }));
      ok(st.expanded === "false" && st.onButton, `${tag} Escape did not close and return focus (${JSON.stringify(st)})`);
      // click toggles
      await button.click(); await page.waitForTimeout(60);
      ok((await button.getAttribute("aria-expanded")) === "true", `${tag} click did not open`);
      // Tab away closes
      await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
      await page.waitForTimeout(80);
      const afterTab = await page.evaluate(() => ({ exp: document.querySelector("[data-nav-dropdown] button").getAttribute("aria-expanded"), inside: document.querySelector("[data-nav-dropdown]").contains(document.activeElement) }));
      ok(afterTab.inside || afterTab.exp === "false", `${tag} focus left the dropdown but it stayed open`);
      // real mouse hover
      await page.mouse.move(2, h - 5); await page.waitForTimeout(200);
      const box = await page.locator("[data-nav-dropdown] a[data-extra-nav]").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(100);
      ok((await page.locator("[data-nav-dropdown] button").getAttribute("aria-expanded")) === "true", `${tag} mouse hover did not open`);
      await page.mouse.move(2, h - 5); await page.waitForTimeout(350);
      ok((await page.locator("[data-nav-dropdown] button").getAttribute("aria-expanded")) === "false", `${tag} leaving did not close`);
      ok((await overflow()) <= 0.5, `${tag} overflow after interaction`);
    } else {
      const d = await page.evaluate(() => {
        const nav = document.querySelector("header nav[aria-label]");
        const group = document.querySelector("[data-mobile-nav-group]");
        const toggle = group.querySelector("button");
        const b = (e) => e.getBoundingClientRect();
        return { navShown: !!nav && nav.getClientRects().length > 0, exp: toggle.getAttribute("aria-expanded"), tw: b(toggle).width, th: b(toggle).height, linksHiddenBefore: [...group.querySelectorAll("[data-mobile-nav-child]")].every((a) => a.getClientRects().length === 0) };
      });
      ok(!d.navShown, `${tag} desktop nav shown below lg`);
      ok(d.exp === "false" && d.linksHiddenBefore, `${tag} accordion open before interaction`);
      ok(d.tw >= 43.5 && d.th >= 43.5, `${tag} accordion toggle is ${d.tw}x${d.th} (< 44)`);
      await page.locator("[data-mobile-nav-group] button").click(); await page.waitForTimeout(60);
      const o = await page.evaluate(() => {
        const group = document.querySelector("[data-mobile-nav-group]");
        const parent = group.querySelector("[data-mobile-extra-nav]");
        const kids = [...group.querySelectorAll("[data-mobile-nav-child]")];
        const b = (e) => e.getBoundingClientRect();
        return { exp: group.querySelector("button").getAttribute("aria-expanded"), n: kids.length, vis: kids.every((k) => k.getClientRects().length > 0), pl: b(parent).left, pr: b(parent).right, kl: Math.min(...kids.map((k) => b(k).left)), kr: Math.max(...kids.map((k) => b(k).right)), vw: document.documentElement.clientWidth, minH: Math.min(...kids.map((k) => b(k).height)) };
      });
      ok(o.exp === "true" && o.n === 3 && o.vis, `${tag} accordion did not open (${o.exp}, ${o.n}, ${o.vis})`);
      ok(rtl ? o.kr < o.pr - 4 : o.kl > o.pl + 4, `${tag} children not indented on the logical start side`);
      ok(o.kl >= -0.5 && o.kr <= o.vw + 0.5, `${tag} children leave the viewport`);
      ok(o.minH >= 40, `${tag} child row only ${o.minH}px tall`);
      ok((await overflow()) <= 0.5, `${tag} overflow with the accordion open`);
      await page.locator("[data-mobile-nav-group] button").click(); await page.waitForTimeout(60);
      ok((await page.locator("[data-mobile-nav-group] button").getAttribute("aria-expanded")) === "false", `${tag} accordion did not close`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`${strip ? (physical ? "PHYSICAL (negative control)" : "STRIPPED (negative control)") : "production"}: 2 pages x ${viewports.length} viewports, ${checks} checks, ${violations.length} violations`);
for (const v of violations.slice(0, 80)) console.log("  ✗", v);
process.exit(strip ? (violations.length > 0 ? 0 : 1) : violations.length > 0 ? 1 : 0);
