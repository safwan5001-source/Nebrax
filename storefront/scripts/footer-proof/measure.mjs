// CUST-HV V7e-2 — real-Chromium proof of the six footer layouts (production `Footer` markup + the compiled storefront stylesheet +
// the production `FooterGroupDisclosure`, mounted by scripts/footer-proof/mount.tsx). For every page (layout × design variant) in
// AR RTL / EN LTR at 390 / 430 / 768 / 1024 / 1280 / 1440:
//   ALL      : no horizontal overflow · identity (CR number) visible · every colour the footer draws (headings, links, muted text, trust text)
//              clears 4.5:1 against the footer's own computed background (designed or not) · group links are ≥ 44 px targets ·
//              the designed background / explicit colours / spacing land exactly · exactly one social mark, WhatsApp link, app badge (no duplication)
//   compact  : brand · link row · social share one row from lg (inline order mirrored under RTL), stack below
//   columns  : brand block first on the inline-start side with the groups on its row from lg; full-width brand + 2-col groups on phones;
//              groups past the fourth collapse into aria-expanded disclosures below md (and only there), toggling works
//   centered : brand centred on the container at every width (or at the chosen end); links never leave the container
//   editorial: the statement (a <p>) sits on the inline-start side of the groups from lg, above them below
//   minimal  : copyright · ≤ 3 links · social on one line from lg; no separate bottom bar
//   brand-heavy: the CTA band (a labelled <section>) above the groups at every width, carrying WhatsApp + app badges;
//              every group is a collapsed disclosure below md
// `--strip` removes the lg row / 12-column rules from the stylesheet (the desktop structure checks must fail); `--lie` overrides the
// link colour with the background's own colour at runtime (the contrast check must fail).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   FOOTER_PROOF_DIR=<dir> npx vitest run src/components/layout/__tests__/footer-proof.render.test.tsx
//   node scripts/footer-proof/measure.mjs <dir> [--strip|--lie]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");
const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
const esbuild = createRequire(join(root, "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/"))("esbuild");
const bundle = esbuild.buildSync({
  entryPoints: [join(root, "scripts/footer-proof/mount.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@": join(root, "src") }, define: { "process.env.NODE_ENV": '"production"' }, absWorkingDir: root,
}).outputFiles[0].text;
const dir = resolve(process.argv[2]);
const strip = process.argv.includes("--strip");
const lie = process.argv.includes("--lie");
let css = readFileSync(join(dir, "storefront.css"), "utf8");
if (strip) {
  const parsed = postcss.parse(css);
  parsed.walkRules((r) => { if (/lg\\:(flex-row|grid-cols-12|col-span-5|col-span-7|grid-cols-\\\[)/.test(r.selector)) r.remove(); });
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
const hexOf = (c) => `#${rgb(c).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

const measure = (page) => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const r = (e) => { if (!e || !vis(e)) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 }; };
  const col = (e) => (e ? getComputedStyle(e).color : null);
  const footer = document.querySelector("footer");
  const container = footer.firstElementChild;
  const cs = getComputedStyle(container);
  const brand = footer.querySelector('a[href="/sa/en"]');
  const groupNavs = [...footer.querySelectorAll("nav[aria-labelledby^='footer-g-']")];
  const quick = footer.querySelector("nav[aria-label]");
  const social = footer.querySelector('a[href*="instagram.com"]');
  const band = footer.querySelector("section[data-footer-band]");
  const trust = footer.querySelector("[data-footer-trust]");
  const statement = [...footer.querySelectorAll("p")].find((p) => p.className.includes("text-2xl"));
  const tagline = [...footer.querySelectorAll("p")].find((p) => /Fresh flowers|ورود طازجة/.test(p.textContent));
  const copyright = [...footer.querySelectorAll("p")].find((p) => /^©/.test(p.textContent.trim()));
  const identity = [...footer.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.includes("1010123456"));
  const linkAnchors = [...footer.querySelectorAll("nav[aria-labelledby^='footer-g-'] a, nav[aria-label] a")];
  const headingEls = [...footer.querySelectorAll("h2")];
  const buttons = [...footer.querySelectorAll("button[aria-expanded]")];
  return {
    vw: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    footerBg: getComputedStyle(footer).backgroundColor, footerRect: r(footer), footerChildren: footer.children.length,
    container: r(container), padTop: parseFloat(cs.paddingTop), padBottom: parseFloat(cs.paddingBottom),
    brand: r(brand), groups: groupNavs.map(r), quick: r(quick), quickLinks: quick ? quick.querySelectorAll("a").length : 0, social: r(social), band: r(band),
    bandHas: band ? { wa: !!band.querySelector('a[href*="wa.me"]'), app: !!band.querySelector('a[href*="apps.apple.com"]'), cta: r(band.querySelector('a[href$="/products"]')) } : null,
    trustHas: trust ? { app: !!trust.querySelector('a[href*="apps.apple.com"]'), wa: !!trust.querySelector('a[href*="wa.me"]') } : null,
    statement: statement ? { ...r(statement), tag: statement.tagName } : null,
    tagline: tagline ? { ...r(tagline), align: getComputedStyle(tagline).textAlign } : null,
    copyright: r(copyright), identity: r(identity),
    counts: { social: footer.querySelectorAll('a[href*="instagram.com"]').length, wa: footer.querySelectorAll('a[href*="wa.me"]').length, app: footer.querySelectorAll('a[href*="apps.apple.com"]').length },
    colours: {
      brand: col(brand?.querySelector("span") ?? brand), headings: headingEls.map(col), links: linkAnchors.filter((a) => !a.querySelector("[data-nav-badge]")).map(col),
      tagline: col(tagline), copyright: col(copyright), trust: col(trust),
    },
    linkRects: linkAnchors.map(r).filter(Boolean),
    buttons: buttons.map((b) => ({ exp: b.getAttribute("aria-expanded"), ctl: b.getAttribute("aria-controls"), t: r(b).t })),
    hiddenPanels: groupNavs.length ? [...footer.querySelectorAll("nav[data-collapsed], nav[aria-labelledby^='footer-g-']")].filter((n) => n.hasAttribute("data-collapsed")).map((n) => !vis(n.querySelector("ul"))) : [],
    groupButtonCount: groupNavs.map((n) => n.querySelectorAll("button").length),
  };
});

const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html")).sort();
for (const file of files) {
  const [layout, variant, dirName] = file.replace(".html", "").split(".");
  const rtl = dirName === "rtl";
  const html = readFileSync(join(dir, "pages", file), "utf8").replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`);
  for (const [w, h] of viewports) {
    const tag = `${layout}.${variant}.${dirName}@${w}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.addScriptTag({ content: bundle });
    await page.waitForTimeout(150);
    if (lie) await page.evaluate(() => { const f = document.querySelector("footer"); f.style.setProperty("--store-footer-link", getComputedStyle(f).backgroundColor); });
    const m = await measure(page);
    const lg = w >= 1024, md = w >= 768;
    const G = m.groups;

    // ── ALL ──
    ok(m.overflowX <= 0.5, `${tag} horizontal overflow ${m.overflowX}`);
    ok(m.identity && m.identity.h > 0, `${tag} identity (CR number) not visible`);
    ok(m.counts.social === 1 && m.counts.wa === 1 && m.counts.app === 1, `${tag} duplicated or missing marks ${JSON.stringify(m.counts)}`);
    const bg = rgb(m.footerBg);
    const samples = [["brand", m.colours.brand], ["tagline", m.colours.tagline], ["copyright", m.colours.copyright], ["trust", m.colours.trust], ...m.colours.headings.map((c) => ["heading", c]), ...m.colours.links.map((c) => ["link", c])].filter(([, c]) => c);
    for (const [name, c] of samples) ok(ratio(rgb(c), bg) >= 4.5, `${tag} ${name} contrast ${ratio(rgb(c), bg).toFixed(2)} (${c} on ${m.footerBg})`);
    for (const lr of m.linkRects) ok(lr.h >= 43.5, `${tag} a footer link is only ${lr.h.toFixed(1)}px tall`);
    if (variant === "light") ok(hexOf(m.footerBg) === "#f8fafc", `${tag} designed background ${m.footerBg}`);
    if (variant === "brand") { ok(hexOf(m.footerBg) === "#12372a", `${tag} brand-role background ${m.footerBg}`); ok(near(m.padTop, md ? 80 : 56, 1) && near(m.padBottom, md ? 32 : 24, 1), `${tag} spacing ${m.padTop}/${m.padBottom}`); }
    if (variant === "explicit") { ok(m.colours.headings.every((c) => hexOf(c) === "#fde68a"), `${tag} explicit heading colour ${m.colours.headings[0]}`); ok(m.colours.links.every((c) => hexOf(c) === "#e2e8f0"), `${tag} explicit link colour`); }
    const alignEnd = variant === "endalign";

    // ── per layout ──
    if (layout === "compact") {
      const parts = [m.brand, m.quick, m.social];
      if (lg) {
        for (const [a, b] of [[0, 1], [1, 2]]) ok(parts[a].t < parts[b].b && parts[b].t < parts[a].b, `${tag} compact row broken between ${a}/${b}`);
        ok(rtl ? parts[0].l >= parts[1].r - 1 && parts[1].l >= parts[2].r - 1 : parts[0].r <= parts[1].l + 1 && parts[1].r <= parts[2].l + 1, `${tag} compact inline order`);
      } else {
        ok(parts[0].b <= parts[1].t + 1 && parts[1].b <= parts[2].t + 1, `${tag} compact does not stack`);
      }
    }
    if (layout === "columns") {
      ok(G.length === (variant === "g6" ? 6 : 3), `${tag} group count ${G.length}`);
      const brandBlock = m.brand;
      if (lg) {
        for (const g of G.slice(0, 4)) ok(near(g.t, G[0].t, 2), `${tag} first-row groups not aligned`);
        ok(near(brandBlock.t, G[0].t, 40), `${tag} brand not on the groups' row`);
        ok(rtl ? brandBlock.r > G[0].r : brandBlock.l < G[0].l, `${tag} brand not on the inline-start side`);
      } else {
        ok(G[0].t >= brandBlock.b - 1, `${tag} groups not below the brand`);
      }
      if (variant === "g6") {
        if (!md) {
          ok(m.buttons.length === 2, `${tag} expected 2 disclosures, got ${m.buttons.length}`);
          ok(m.groupButtonCount.slice(0, 4).every((n) => n === 0) && m.groupButtonCount.slice(4).every((n) => n === 1), `${tag} wrong groups collapsed ${m.groupButtonCount}`);
          ok(m.buttons.every((b) => b.exp === "false"), `${tag} disclosure open at load`);
          const btn = page.locator("button[aria-expanded]").first();
          const before = (await measure(page)).footerRect.h;
          await btn.click();
          const after = await measure(page);
          ok(after.buttons[0].exp === "true" && after.footerRect.h > before, `${tag} disclosure did not open (${before} -> ${after.footerRect.h})`);
          ok(after.overflowX <= 0.5, `${tag} overflow with a disclosure open`);
          await page.keyboard.press("Enter"); // the button keeps focus after the click: Enter toggles it shut
          ok((await measure(page)).buttons[0].exp === "false", `${tag} keyboard did not close the disclosure`);
        } else ok(m.buttons.length === 0, `${tag} disclosure buttons from md up (${m.buttons.length})`);
      }
    }
    if (layout === "centered") {
      const c = m.container;
      const inner = { l: c.l + parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector("footer").firstElementChild).paddingLeft)), r: 0 };
      if (!alignEnd) ok(near(m.brand.cx, m.footerRect.cx, 2), `${tag} brand not centred (${m.brand.cx} vs ${m.footerRect.cx})`);
      else ok(rtl ? m.brand.l <= m.container.l + 80 : m.brand.r >= m.container.r - 80, `${tag} end-aligned brand not at the end`);
      for (const lr of m.linkRects) ok(lr.l >= -0.5 && lr.r <= m.vw + 0.5, `${tag} a link leaves the viewport`);
      void inner;
    }
    if (layout === "editorial") {
      ok(m.statement && m.statement.tag === "P", `${tag} statement is not a paragraph`);
      if (lg) ok(rtl ? m.statement.l >= G[0].r - 1 || m.statement.l >= Math.max(...G.map((g) => g.r)) - 1 : m.statement.r <= Math.min(...G.map((g) => g.l)) + 8, `${tag} statement not on the inline-start side`);
      else ok(m.statement.b <= G[0].t + 1, `${tag} statement not above the groups`);
    }
    if (layout === "minimal") {
      ok(m.footerChildren === 1, `${tag} minimal still has a bottom bar (${m.footerChildren} children)`);
      ok(m.quickLinks <= 3, `${tag} minimal draws ${m.quickLinks} links`);
      const parts = [m.copyright, m.quick, m.social];
      if (lg) for (const [a, b] of [[0, 1], [1, 2]]) ok(parts[a].t < parts[b].b && parts[b].t < parts[a].b, `${tag} minimal not on one line (${a}/${b})`);
    }
    if (layout === "brand-heavy") {
      ok(m.band && G[0].t >= m.band.b - 1, `${tag} band not above the groups`);
      ok(m.bandHas.wa && m.bandHas.app && !m.trustHas.app && !m.trustHas.wa, `${tag} band/trust split ${JSON.stringify([m.bandHas, m.trustHas])}`);
      ok(m.bandHas.cta && m.bandHas.cta.h >= 43.5, `${tag} CTA not a ≥44px target`);
      if (!md) {
        ok(m.buttons.length === G.length && m.buttons.every((b) => b.exp === "false"), `${tag} groups not all collapsed (${m.buttons.length}/${G.length})`);
        ok(m.hiddenPanels.every(Boolean), `${tag} a collapsed group's links are visible`);
        await page.locator("button[aria-expanded]").first().click();
        ok((await measure(page)).buttons[0].exp === "true", `${tag} brand-heavy disclosure did not open`);
      } else ok(m.buttons.length === 0, `${tag} disclosure buttons from md up`);
    }
    if (alignEnd) ok(m.tagline && (m.tagline.align === "end" || m.tagline.align === (rtl ? "left" : "right")), `${tag} tagline not end-aligned (${m.tagline?.align})`);
    await ctx.close();
  }
}
await browser.close();
console.log(`${strip ? "STRIPPED (negative control)" : lie ? "LIE (negative control)" : "production"}: ${files.length} pages x ${viewports.length} viewports, ${checks} checks, ${violations.length} violations`);
for (const v of violations.slice(0, 60)) console.log("  ✗", v);
if (violations.length > 60) console.log(`  … ${violations.length - 60} more`);
process.exit(strip || lie ? (violations.length > 0 ? 0 : 1) : violations.length > 0 ? 1 : 0);
