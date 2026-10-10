// CUST-HV V6c-5 — real-Chromium proof of per-CTA `style` (solid | outline | link) on the published hero and banner:
//   * a button's paint adds NO new contrast surface: `link` and `outline` use exactly the section heading's colour
//     (the colour the section proves against its own backdrop), `solid` keeps its label >= 4.5:1 over its own fill;
//   * `link` keeps the tap height (hero 36px / 44px from md, banner 40px) and an underline; `outline` keeps its 2px border;
//   * the two buttons never overlap, stay inside the section, and nothing overflows horizontally;
//   * absent style is EXACTLY the explicit positional default (solid, outline): identical computed styles.
// default surface and proven picture background x 6 viewports x AR RTL / EN LTR.
// `--strip` injects a rule that recolours link buttons (negative control: it must fail).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   CTA_STYLE_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/cta-style-proof.render.test.tsx
//   node scripts/cta-style-proof/measure.mjs <dir> [--strip]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const req = createRequire(join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "package.json"));
const { chromium } = req("@playwright/test");
const dir = resolve(process.argv[2]);
const strip = process.argv.includes("--strip");
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html")).sort();
const violations = [];
let checks = 0, buttons = 0, equalityChecks = 0;
const signatures = new Map(); // `${type}.${kind}.${dir}@${w}` -> { auto: sig, explicit: sig }

const measure = (page) =>
  page.evaluate(() => {
    const section = document.querySelector("main section");
    const heading = section.querySelector("h1, h2");
    const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const s = section.getBoundingClientRect();
    const headingColor = getComputedStyle(heading).color;
    const out = [...section.querySelectorAll("a[data-cta-style]")].map((a) => {
      const cs = getComputedStyle(a), r = a.getBoundingClientRect();
      const bg = parse(cs.backgroundColor), fg = parse(cs.color);
      return {
        style: a.getAttribute("data-cta-style"), color: cs.color, bg: cs.backgroundColor, bgAlpha: bg.a,
        contrastOwnFill: bg.a === 1 ? ratio(fg, bg) : null,
        border: cs.borderTopWidth, deco: cs.textDecorationLine, h: r.height,
        rect: { l: r.left, r: r.right, t: r.top, b: r.bottom },
        sig: [cs.color, cs.backgroundColor, cs.borderTopWidth, cs.borderTopColor, cs.textDecorationLine, cs.paddingLeft, cs.height, cs.fontWeight].join("|"),
      };
    });
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headingColor, section: { l: s.left, r: s.right, t: s.top, b: s.bottom }, buttons: out,
    };
  });

for (const f of files) {
  const [type, kind, combo, dirName] = f.replace(/\.html$/, "").split(".");
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto("file://" + join(dir, "pages", f));
    if (strip) await page.addStyleTag({ content: '[data-cta-style="link"]{color:#8a8a8a !important}' });
    await page.waitForLoadState("load");
    const r = await measure(page);
    checks++;
    const tag = `${f}@${w}x${h}`;
    if (r.overflowX > 0) violations.push(`${tag}: horizontal overflow ${r.overflowX}`);
    const minTap = type === "banner" ? 40 : w >= 768 ? 44 : 36;
    r.buttons.forEach((b, i) => {
      buttons++;
      if (b.h < minTap - 0.5) violations.push(`${tag}: button ${i} (${b.style}) is ${b.h.toFixed(1)}px < ${minTap}px`);
      if (b.rect.l < r.section.l - 1 || b.rect.r > r.section.r + 1) violations.push(`${tag}: button ${i} sticks out of the section`);
      if (b.style === "solid") {
        if (b.bgAlpha !== 1) violations.push(`${tag}: solid button ${i} fill is not opaque`);
        else if (b.contrastOwnFill < 4.5) violations.push(`${tag}: solid button ${i} label ${b.contrastOwnFill.toFixed(2)}:1 over its own fill`);
      }
      if (b.style === "outline") {
        if (parseFloat(b.border) < 2) violations.push(`${tag}: outline button ${i} border ${b.border}`);
        if (b.color !== r.headingColor && type === "banner") violations.push(`${tag}: outline label ${b.color} != heading ${r.headingColor}`);
      }
      if (b.style === "link") {
        if (!b.deco.includes("underline")) violations.push(`${tag}: link button ${i} has no underline`);
        if (b.color !== r.headingColor && type === "banner") violations.push(`${tag}: link label ${b.color} != heading ${r.headingColor}`);
        if (type === "hero" && b.color !== r.headingColor) violations.push(`${tag}: link label ${b.color} != heading ${r.headingColor}`);
        if (b.bgAlpha !== 0) violations.push(`${tag}: link button ${i} has a fill (${b.bg})`);
      }
    });
    if (r.buttons.length === 2) {
      const [a, b] = r.buttons;
      const overlapX = Math.min(a.rect.r, b.rect.r) - Math.max(a.rect.l, b.rect.l);
      const overlapY = Math.min(a.rect.b, b.rect.b) - Math.max(a.rect.t, b.rect.t);
      if (overlapX > 0.5 && overlapY > 0.5) violations.push(`${tag}: the two buttons overlap`);
    }
    if (r.buttons.length !== 2) violations.push(`${tag}: expected 2 buttons, found ${r.buttons.length}`);
    if (combo === "auto" || combo === "explicit-default") {
      const key = `${type}.${kind}.${dirName}@${w}`;
      const entry = signatures.get(key) ?? {};
      entry[combo] = r.buttons.map((b) => b.sig).join("||");
      signatures.set(key, entry);
    }
    await page.close();
  }
}
for (const [key, e] of signatures) {
  equalityChecks++;
  if (e.auto !== e["explicit-default"]) violations.push(`${key}: absent style differs from the explicit positional default`);
}
await browser.close();
const summary = { pages: files.length, checks, buttons, equalityChecks, strip, violations: violations.length, sample: violations.slice(0, 10) };
if (!strip) writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, violations }, null, 1));
console.log(JSON.stringify(summary));
violations.slice(0, 25).forEach((v) => console.log(v));
process.exit(violations.length ? 1 : 0);
