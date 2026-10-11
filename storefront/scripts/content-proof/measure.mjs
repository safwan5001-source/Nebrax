// CUST-HV V9c-1 — real-Chromium proof of the published Custom Content blocks (production `publishedNodes` → `resolveContentBlocks` →
// `CustomContentBand` markup + the compiled storefront stylesheet). For every page (mixed / columns / aligned / designed) in AR RTL / EN LTR at
// 390 / 430 / 768 / 1024 / 1280 / 1440 it checks:
//   LAYOUT    no horizontal overflow · every block's text stays inside it (an unbroken word wraps) · pictures decode and keep their natural
//             ratio, never wider than their container · columns STACK below 768 px (same inline-start edge, one under the other, DOM order) and sit
//             side by side from 768 px (equal widths, the first column on the inline-start edge)
//   ALIGN     start = flush to the inline-start edge, `center` centred, `end` flush to the inline-end edge (mirrored under RTL, never physical)
//   BLOCKS    spacer heights 16 / 32 / 56 px · a line divider is a 1 px rule, dots are three · buttons ≥ 40 px tall and never wider than the page ·
//             a callout has an inline-start accent border, its text meets 4.5 : 1 against its own surface, designed or not · the tone is also
//             present as text for assistive technology · paragraph line breaks are kept
// Negative controls (each must make this script FAIL): --physical (alignment as physical right) · --nostack (columns never sit side by side) ·
// --widepics (pictures lose their max width).
//   node scripts/pixel-proof/build-css.mjs <dir>; node scripts/slider-proof/make-pictures.mjs <dir>
//   CONTENT_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/content-proof.render.test.tsx
//   node scripts/content-proof/measure.mjs <dir> [--physical|--nostack|--widepics] [--shots <outDir>]   (PIXEL_PROOF_CHROMIUM=<path>)
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
if (flag("--physical")) css = css.replace(/text-align:\s*end/g, "text-align: right");
// the other two controls break the page by appending a rule, whatever the compiled stylesheet looks like
if (flag("--nostack")) css += "\n[data-content-columns]{grid-template-columns:minmax(0,1fr)!important}";
if (flag("--widepics")) css += "\nfigure img{width:4000px!important;max-width:none!important}";
const inlineCss = (html) => html.replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`);

const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const VIEWPORTS = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const PAGES = ["mixed", "columns", "aligned", "designed"];
const violations = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) violations.push(msg); };
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a]; return (lum(hi) + 0.05) / (lum(lo) + 0.05); };
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

const snap = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.99)) return c; } return "rgb(255,255,255)"; };
  const section = document.querySelector("[data-content-blocks], section");
  const text = [...section.querySelectorAll("h2, h3, p, figcaption")].map((e) => ({ tag: e.tagName, rect: r(e), over: e.scrollWidth - e.clientWidth, align: getComputedStyle(e).textAlign, id: e.id, text: e.textContent.slice(0, 20), pre: getComputedStyle(e).whiteSpace }));
  return {
    vw: window.innerWidth, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    section: r(section), dir: getComputedStyle(section).direction, text,
    pics: [...section.querySelectorAll("figure img")].map((i) => ({ rect: r(i), nw: i.naturalWidth, nh: i.naturalHeight, loaded: i.complete && i.naturalWidth > 0, container: r(i.closest("figure")) })),
    columns: (() => { const g = section.querySelector("[data-content-columns]"); return g ? { grid: r(g), cells: [...g.querySelectorAll("[data-content-column]")].map(r) } : null; })(),
    spacers: [...section.querySelectorAll("[data-content-spacer]")].map((e) => ({ kind: e.dataset.contentSpacer, h: r(e).h })),
    hr: [...section.querySelectorAll("hr")].map((e) => ({ h: r(e).h, border: getComputedStyle(e).borderTopWidth })),
    dots: [...section.querySelectorAll('[data-content-divider="dots"] span')].map((e) => r(e)),
    buttons: [...section.querySelectorAll("[data-content-button] a")].map((a) => ({ rect: r(a), over: a.scrollWidth - a.clientWidth })),
    callouts: [...section.querySelectorAll("aside")].map((a) => { const p = a.querySelector("p"); const cs = getComputedStyle(a); return { tone: a.dataset.contentCallout, color: getComputedStyle(p).color, bg: bgOf(a), startW: cs.borderInlineStartWidth, startC: cs.borderInlineStartColor, sr: a.querySelector(".sr-only")?.textContent ?? "", icon: !!a.querySelector("svg"), rect: r(a), over: a.scrollWidth - a.clientWidth }; }),
  };
});

for (const name of PAGES) {
  for (const d of ["ltr", "rtl"]) {
    const rtl = d === "rtl";
    const path = join(dir, "pages", `${name}.${d}.html`);
    writeFileSync(path, inlineCss(readFileSync(path, "utf8")));
    for (const [w, h] of VIEWPORTS) {
      const tag = `${name}.${d}@${w}`;
      const context = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await context.newPage();
      await page.goto(`file://${path}`);
      await page.waitForSelector("section");
      await page.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = "eager"; return i.decode().catch(() => {}); })));
      const s = await snap(page);
      const start = (rect) => (rtl ? s.section.r - rect.r : rect.l - s.section.l);
      const end = (rect) => (rtl ? rect.l - s.section.l : s.section.r - rect.r);

      ok(s.dir === d, `${tag}: direction ${s.dir}`);
      ok(s.overflowX <= 1, `${tag}: horizontal overflow ${s.overflowX}px`);
      ok(s.section.w <= w, `${tag}: section wider than the viewport`);
      for (const t of s.text) ok(t.over <= 1, `${tag}: "${t.text}" overflows its box by ${t.over}px`);
      for (const p of s.pics) {
        ok(p.loaded, `${tag}: a picture did not decode`);
        ok(p.rect.w <= p.container.w + 1, `${tag}: picture ${Math.round(p.rect.w)}px wider than its container ${Math.round(p.container.w)}px`);
        ok(near(p.rect.w / p.rect.h, p.nw / p.nh, 0.03), `${tag}: picture ratio ${(p.rect.w / p.rect.h).toFixed(3)} vs natural ${(p.nw / p.nh).toFixed(3)}`);
      }
      if (s.columns) {
        const [a, b] = s.columns.cells;
        if (w < 768) {
          ok(near(start(a), start(b)), `${tag}: stacked columns do not share the inline-start edge`);
          ok(b.t >= a.b - 1, `${tag}: columns did not stack below 768px`);
        } else {
          ok(near(a.w, b.w, 2), `${tag}: column widths ${a.w} vs ${b.w}`);
          ok(near(a.t, b.t, 2), `${tag}: columns not side by side from 768px`);
          ok(start(a) < start(b), `${tag}: the first column is not on the inline-start side`);
          ok(near(start(a), 0, 1.5), `${tag}: the first column does not touch the inline-start edge`);
        }
      }
      if (name === "aligned") {
        const heads = s.text.filter((t) => t.tag === "H2" || t.tag === "H3");
        const paras = s.text.filter((t) => t.tag === "P");
        for (const [i, group] of [heads, paras].entries()) {
          const [plain, centre, endd] = group;
          if (!plain || !centre || !endd) { ok(false, `${tag}: missing aligned samples`); continue; }
          // text-align acts on the line boxes; measure the Range of the text itself
          ok(plain.align === "start" || plain.align === "-webkit-auto" || plain.align === "left" || plain.align === "right", `${tag}: group ${i} plain align ${plain.align}`);
          ok(centre.align === "center", `${tag}: centre block align ${centre.align}`);
          ok(endd.align === "end" || (rtl ? endd.align === "left" : endd.align === "right"), `${tag}: end block align ${endd.align} (must be logical or the mirrored side)`);
        }
        const ends = await page.evaluate(() => [...document.querySelectorAll("section h2, section h3, section p")].filter((e) => !e.className.includes("sr-only")).map((e) => { const rg = document.createRange(); rg.selectNodeContents(e); const b = rg.getBoundingClientRect(); const s0 = e.getBoundingClientRect(); return { l: b.left - s0.left, r: s0.right - b.right, w: b.width, W: s0.width }; }));
        const [ph, ch, eh, pp, cp, ep] = [ends[0], ends[1], ends[2], ends[3], ends[4], ends[5]];
        for (const [label, plain, centre, endd] of [["heading", ph, ch, eh], ["paragraph", pp, cp, ep]]) {
          const dirStart = rtl ? "r" : "l", dirEnd = rtl ? "l" : "r";
          ok(plain[dirStart] <= 1.5, `${tag}: plain ${label} not flush to the inline-start edge`);
          ok(near(centre.l, centre.r, 2), `${tag}: centred ${label} not centred (${centre.l.toFixed(1)} / ${centre.r.toFixed(1)})`);
          ok(endd[dirEnd] <= 1.5, `${tag}: end ${label} not flush to the inline-end edge`);
        }
      }
      for (const sp of s.spacers) ok(near(sp.h, { sm: 16, md: 32, lg: 56 }[sp.kind], 1), `${tag}: spacer ${sp.kind} is ${sp.h}px`);
      for (const hr of s.hr) ok(hr.h <= 1.5 && hr.border === "1px", `${tag}: hr ${hr.h}px / border ${hr.border}`);
      if (name === "aligned") ok(s.dots.length === 3 && s.dots.every((x) => near(x.w, 6, 0.6)), `${tag}: dots divider has ${s.dots.length} dots`);
      for (const b of s.buttons) {
        ok(b.rect.h >= 39.5, `${tag}: button ${b.rect.h}px tall`);
        ok(b.rect.w <= w && b.over <= 1, `${tag}: button wider than the page`);
      }
      for (const c of s.callouts) {
        ok(ratio(rgb(c.color), rgb(c.bg)) >= 4.5, `${tag}: callout text ${ratio(rgb(c.color), rgb(c.bg)).toFixed(2)}:1 on ${c.bg}`);
        ok(c.startW === "4px" && !/rgba\(0, 0, 0, 0\)/.test(c.startC), `${tag}: callout accent border ${c.startW} ${c.startC}`);
        ok(c.sr.length > 0, `${tag}: callout tone is not present as text`);
        ok(c.over <= 1, `${tag}: callout overflows by ${c.over}px`);
      }
      if (name === "mixed") {
        const para = s.text.find((t) => t.tag === "P");
        ok(para.pre === "pre-line", `${tag}: paragraph keeps line breaks (${para.pre})`);
      }
      if (shotsAt && (w === 390 || w === 1280)) await page.screenshot({ path: join(shotsAt, `${tag}.png`), fullPage: true });
      await context.close();
    }
  }
}
await browser.close();
console.log(`${checks} checks, ${violations.length} violations`);
for (const v of violations.slice(0, 40)) console.log("  ✗", v);
process.exit(violations.length ? 1 : 0);
