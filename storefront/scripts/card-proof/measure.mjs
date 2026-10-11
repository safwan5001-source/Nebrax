// CUST-HV V9d-1 — real-Chromium proof of the card tokens (V0 §14.1): the production ProductCard and OfferCard + the compiled storefront stylesheet,
// inside a wrapper carrying what the production resolver returns for each variant. For every variant in AR RTL / EN LTR at 390 / 768 / 1280 it checks:
//   BASE       with no token a card is exactly today's: start-aligned body, a height-sized cover image (144 / 176 / 208 px), a soft hover shadow and a
//              3 % image zoom
//   ALIGN      `center` centres the body text and the price row (the price sits on the card's centre line), in both directions
//   RATIO      `1:1` / `4:3` / `3:4` give every image frame (product AND offer) that aspect ratio at every width
//   FIT        `contain` lays the whole picture inside the frame (computed object-fit)
//   HOVER      `none` = no shadow, no lift, no zoom · `lift` = −4 px and a shadow, no zoom · `zoom` = 1.06 image zoom, no shadow, no lift ·
//              and under prefers-reduced-motion nothing moves
//   COMMERCE   every price, name, category, badge and availability string is IDENTICAL to the base page in every variant — a card token changes how a
//              card looks, never what it says (V0 §14.3)
//   LAYOUT     no horizontal overflow; every card stays inside the viewport
// Negative controls (each must make this script FAIL): --noratio (ratio rule removed) · --nohover (hover rules removed) · --noalign (alignment
// rule removed) · --leak (a rule that hides every price).
//   node scripts/pixel-proof/build-css.mjs <dir>; node scripts/slider-proof/make-pictures.mjs <dir>
//   CARD_PROOF_DIR=<dir> npx vitest run src/components/products/__tests__/card-proof.render.test.tsx
//   node scripts/card-proof/measure.mjs <dir> [--noratio|--nohover|--noalign|--leak] [--shots <outDir>]   (PIXEL_PROOF_CHROMIUM=<path>)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");

const dir = resolve(process.argv[2]);
const flag = (f) => process.argv.includes(f);
const shotsAt = flag("--shots") ? resolve(process.argv[process.argv.indexOf("--shots") + 1]) : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

let css = readFileSync(join(dir, "storefront.css"), "utf8");
// next/image `fill` (the proof renders with a stub that emits a plain <img>): what it adds as inline style
css += "\n[data-card-image] img{position:absolute;inset:0;width:100%;height:100%}";
const strip = (re) => { css = css.replace(re, ""); };
if (flag("--noratio")) strip(/\[data-gt~="cd-ir"\] \[data-card-image\]\s*\{[^}]*\}/g);
if (flag("--nohover")) {
  strip(/\[data-gt~="cd-hv"\] \[data-card\]:is\(:hover, :focus-within\)\s*\{[^}]*\}/g);
  strip(/\[data-gt~="cd-hv"\] \[data-card\]:hover \[data-card-image\] img\s*\{[^}]*\}/g);
}
if (flag("--noalign")) strip(/\[data-gt~="cd-al"\] \[data-card-body\]\s*\{[^}]*\}/g);
if (flag("--leak")) css += "\n[data-card-price]{visibility:hidden}";
const inlineCss = (html) => html.replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`);

const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const VIEWPORTS = [[390, 844], [768, 1024], [1280, 800]];
const VARIANTS = ["base", "center", "ratio11", "ratio43", "ratio34", "contain", "hovernone", "hoverlift", "hoverzoom", "all"];
const SPEC = {
  base: {}, center: { align: "center" }, ratio11: { ratio: 1 }, ratio43: { ratio: 4 / 3 }, ratio34: { ratio: 3 / 4 }, contain: { fit: "contain" },
  hovernone: { hover: "none" }, hoverlift: { hover: "lift" }, hoverzoom: { hover: "zoom" }, all: { align: "center", ratio: 4 / 3, fit: "contain", hover: "lift" },
};
const violations = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) violations.push(msg); };
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

const snap = (page) => page.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2 }; };
  const cards = [...document.querySelectorAll("[data-card]")].map((card) => {
    const body = card.querySelector("[data-card-body]");
    const price = card.querySelector("[data-card-price]");
    const img = card.querySelector("[data-card-image] img");
    return {
      rect: r(card), image: r(card.querySelector("[data-card-image]")), body: r(body), bodyAlign: getComputedStyle(body).textAlign,
      priceJustify: price ? getComputedStyle(price).justifyContent : null,
      priceFirst: price?.firstElementChild ? r(price.firstElementChild) : null,
      // the price row's own content box (every item in it): centred as a group, not item by item
      priceGroup: price && price.children.length ? (() => { const kids = [...price.children].map(r); return { l: Math.min(...kids.map((k) => k.l)), r: Math.max(...kids.map((k) => k.r)) }; })() : null,
      fit: img ? getComputedStyle(img).objectFit : null,
      // everything a shopper reads on the card, in order
      text: card.innerText.replace(/\s+/g, " ").trim(),
      prices: [...card.querySelectorAll("[data-card-price]")].map((p) => p.textContent.replace(/\s+/g, " ").trim()),
      priceVisible: [...card.querySelectorAll("[data-card-price]")].every((p) => getComputedStyle(p).visibility === "visible" && getComputedStyle(p).display !== "none" && p.getBoundingClientRect().height > 0),
    };
  });
  return { vw: window.innerWidth, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, cards };
});

const baseText = {};
for (const variant of VARIANTS) {
  for (const d of ["ltr", "rtl"]) {
    const rtl = d === "rtl";
    const path = join(dir, "pages", `${variant}.${d}.html`);
    writeFileSync(path, inlineCss(readFileSync(path, "utf8")));
    for (const [w, h] of VIEWPORTS) {
      const tag = `${variant}.${d}@${w}`;
      const spec = SPEC[variant];
      const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "no-preference" });
      const page = await context.newPage();
      await page.goto(`file://${path}`);
      await page.waitForSelector("[data-card]");
      await page.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = "eager"; return i.decode().catch(() => {}); })));
      const s = await snap(page);
      ok(s.overflowX <= 1, `${tag}: horizontal overflow ${s.overflowX}px`);
      ok(s.cards.length === 4, `${tag}: ${s.cards.length} cards`);
      for (const [i, c] of s.cards.entries()) {
        ok(c.rect.l >= -0.5 && c.rect.r <= w + 0.5, `${tag}: card ${i} outside the viewport`);
        if (spec.ratio) ok(near(c.image.w / c.image.h, spec.ratio, 0.03), `${tag}: card ${i} frame ratio ${(c.image.w / c.image.h).toFixed(3)} (want ${spec.ratio.toFixed(3)})`);
        else {
          const want = w >= 768 ? 208 : w >= 640 ? 176 : 144;
          ok(near(c.image.h, want, 1), `${tag}: card ${i} frame height ${c.image.h} (today's ${want})`);
        }
        if (spec.fit) ok(c.fit === spec.fit, `${tag}: card ${i} object-fit ${c.fit}`);
        else if (c.fit) ok(c.fit === "cover", `${tag}: card ${i} object-fit ${c.fit} (today's cover)`);
        if (spec.align === "center") {
          ok(c.bodyAlign === "center", `${tag}: card ${i} body align ${c.bodyAlign}`);
          if (c.priceGroup) ok(near((c.priceGroup.l + c.priceGroup.r) / 2, c.body.cx, 12), `${tag}: card ${i} price row not on the centre line (${((c.priceGroup.l + c.priceGroup.r) / 2).toFixed(1)} vs ${c.body.cx.toFixed(1)})`);
        } else {
          ok(c.bodyAlign === "start" || c.bodyAlign === "left" || c.bodyAlign === "right", `${tag}: card ${i} body align ${c.bodyAlign} (today's start)`);
          if (c.priceFirst) ok(rtl ? c.body.r - c.priceFirst.r < 20 : c.priceFirst.l - c.body.l < 20, `${tag}: card ${i} price not on the inline-start edge`);
        }
      }
      // COMMERCE: the card's words and prices never change with a token
      const key = `${d}@${w}`;
      if (variant === "base") baseText[key] = s.cards.map((c) => ({ text: c.text, prices: c.prices }));
      else for (const [i, c] of s.cards.entries()) {
        ok(c.text === baseText[key]?.[i]?.text, `${tag}: card ${i} text changed from the base page`);
        ok(JSON.stringify(c.prices) === JSON.stringify(baseText[key]?.[i]?.prices), `${tag}: card ${i} price changed from the base page`);
      }
      ok(s.cards.every((c) => c.priceVisible), `${tag}: a price is hidden`);
      ok(s.cards.every((c) => c.prices.length === 1 && /[\d٠-٩]/.test(c.prices[0])), `${tag}: a card lost its price`);

      // HOVER — first product card, real pointer, then settle
      if (w === 1280 || variant.startsWith("hover") || variant === "all" || variant === "base") {
        const card = page.locator("[data-card]").first();
        const measureHover = async (motion) => {
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: motion });
          const p = await ctx.newPage();
          await p.goto(`file://${path}`);
          await p.waitForSelector("[data-card]");
          await p.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = "eager"; return i.decode().catch(() => {}); })));
          await p.locator("[data-card]").first().hover();
          await p.waitForTimeout(700);
          const out = await p.evaluate(() => {
            const c = document.querySelector("[data-card]");
            const img = c.querySelector("[data-card-image] img");
            const num = (v) => (v === "none" || v === "normal" || v === "" ? null : v.split(/\s+/).map(parseFloat));
            const lift = num(getComputedStyle(c).translate);
            const zoom = num(getComputedStyle(img).scale);
            return { shadow: getComputedStyle(c).boxShadow, ty: lift ? lift[1] ?? 0 : 0, scale: zoom ? zoom[0] : 1 };
          });
          await ctx.close();
          return out;
        };
        const moving = await measureHover("no-preference");
        const still = await measureHover("reduce");
        const wantHover = spec.hover ?? "base";
        const shadowOn = moving.shadow !== "none";
        if (wantHover === "none") ok(!shadowOn && near(moving.ty, 0, 0.2) && near(moving.scale, 1, 0.005), `${tag}: hover none moved (${JSON.stringify(moving)})`);
        if (wantHover === "lift") ok(shadowOn && near(moving.ty, -4, 0.6) && near(moving.scale, 1, 0.005), `${tag}: hover lift (${JSON.stringify(moving)})`);
        if (wantHover === "zoom") ok(!shadowOn && near(moving.ty, 0, 0.2) && near(moving.scale, 1.06, 0.01), `${tag}: hover zoom (${JSON.stringify(moving)})`);
        if (wantHover === "base") ok(shadowOn && near(moving.ty, 0, 0.2) && near(moving.scale, 1.03, 0.01), `${tag}: today's hover changed (${JSON.stringify(moving)})`);
        if (wantHover === "lift" || wantHover === "zoom") ok(near(still.ty, 0, 0.2) && near(still.scale, 1, 0.005), `${tag}: reduced motion still moves (${JSON.stringify(still)})`);
      }
      if (shotsAt && w !== 768 && (variant === "base" || variant === "all" || variant === "center")) await page.screenshot({ path: join(shotsAt, `${tag}.png`), fullPage: true });
      await context.close();
    }
  }
}
await browser.close();
console.log(`${checks} checks, ${violations.length} violations`);
for (const v of violations.slice(0, 40)) console.log("  ✗", v);
process.exit(violations.length ? 1 : 0);
