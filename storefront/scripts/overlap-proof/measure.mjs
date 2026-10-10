// CUST-HV V6c-4 — real-Chromium proof of the hero overlap (the next section rising over the hero's lower edge):
//   * overlap is a >= md (768px) effect that exists only for a proven picture hero with no bottom separator;
//     below 768px, or without a picture / with a separator, the next section starts at or below the hero's edge;
//   * where active, the next section's top sits EXACTLY the preset (sm 2rem, md 4rem) above the hero's bottom edge, and
//     the hero keeps its own height (its visible height equals the same hero with no overlap);
//   * nothing of the hero's content (heading, copy, CTAs) ever reaches the overlapping sheet, and every focusable
//     element on the page is hit-testable at its own centre (no focus ring or link is covered) at all six widths;
//   * a hero that is LAST (only the footer follows) or is followed only by an EMPTY wrapper (a section that rendered
//     nothing) is an ordinary hero: no overlap, nothing pulled under the footer, no empty box promoted to a sheet;
//   * the sheet is above the hero's picture (a point inside the overlap strip hits the sheet, not the backdrop) and opaque;
//   * nothing overflows horizontally.
// 6 viewports x AR RTL / EN LTR. `--strip` removes the overlap rules from the stylesheet (negative control: it must fail); `--ungated` removes only the following-sibling gate (second negative control).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   OVERLAP_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/overlap-proof.render.test.tsx
//   node scripts/overlap-proof/measure.mjs <dir> [--strip | --ungated]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");
const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
const dir = resolve(process.argv[2]);
const strip = process.argv.includes("--strip");
// negative control for the "a renderable sibling follows" gate: the stylesheet as it was before the gate existed
const ungated = process.argv.includes("--ungated");
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const REM = 16;
const PRESET = { sm: 2 * REM, md: 4 * REM };
const TOL = 1;

let stripped = null;
if (strip) {
  const root_ = postcss.parse(readFileSync(join(dir, "storefront.css"), "utf8"));
  root_.walkRules((r) => { if (r.selector.includes("ovlp")) r.remove(); });
  stripped = root_.toString();
}

if (ungated) stripped = readFileSync(join(dir, "storefront.css"), "utf8").replaceAll(":has(+ :not(:empty))", "").replaceAll("+ :not(:empty)", "+ *");

const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html"));
const measure = async (page, kind) =>
  page.evaluate((kind) => {
    const stack = document.querySelector("main > *");
    const kids = [...stack.children];
    // the element that follows the hero for the reader: the next section (the last wrapper), or the footer when the hero is last
    const heroTop = kids[0], next = kind === "last" ? document.getElementById("page-footer") : kids[kids.length - 1];
    const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const hero = rect(heroTop), nx = rect(next);
    const heroContent = [...heroTop.querySelectorAll("h1, h2, p, a, button")].filter((e) => !e.closest("[data-sd-backdrop]")).map((e) => ({ tag: e.tagName, ...rect(e) }));
    const focusables = [...document.querySelectorAll("a[href], button, [tabindex]")];
    const covered = [];
    for (const el of focusables) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // scroll it fully into view, then hit-test its centre
      el.scrollIntoView({ block: "center" });
      const rr = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
      if (!(hit === el || el.contains(hit))) covered.push(`${el.tagName}:${(el.textContent || "").trim().slice(0, 24)}`);
    }
    window.scrollTo(0, 0);
    const probeEl = (() => {
      // a point inside the overlap strip, mid-width of the sheet
      const hr = heroTop.getBoundingClientRect(), nr = next.getBoundingClientRect();
      const y = (nr.top + hr.bottom) / 2, x = (nr.left + nr.right) / 2;
      const strip = hr.bottom - nr.top;
      if (strip < 2) return { strip, hitSheet: null };
      const hit = document.elementFromPoint(x, y);
      return { strip, hitSheet: !!hit && next.contains(hit) || hit === next };
    })();
    const sheetBg = getComputedStyle(next).backgroundColor;
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hero, next: nx, heroContent, covered, probe: probeEl, sheetBg,
      active: heroTop.matches("[data-sd~='ovlp']") || !!heroTop.querySelector(":scope [data-sd~='ovlp']"),
    };
  }, kind);

let checks = 0, activeChecks = 0, inactiveChecks = 0, keyboardChecks = 0;
const violations = [];
const baselines = new Map(); // `${kind}.${height}.${dir}@${w}` -> hero visible height with no overlap
for (const pass of [0, 1]) { // pass 0: collect the no-overlap baselines, pass 1: assert
  for (const f of files.sort()) {
    const [kind, height, overlap, dirName] = f.replace(/\.html$/, "").split(".");
    if ((pass === 0) !== (overlap === "none")) continue;
    for (const [w, h] of viewports) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto("file://" + join(dir, "pages", f));
      if (stripped) await page.evaluate((css) => { document.querySelectorAll("style")[0].textContent = css; }, stripped);
      await page.waitForLoadState("load");
      const r = await measure(page, kind);
      checks++;
      const tag = `${f}@${w}x${h}`;
      const key = `${kind}.${height}.${dirName}@${w}`;
      if (r.overflowX > 0) violations.push(`${tag}: horizontal overflow ${r.overflowX}`);
      const visibleHero = r.hero.h - Math.max(0, r.hero.b - r.next.t); // hero height minus the part the sheet covers
      if (pass === 0) { baselines.set(key, r.hero.h); }
      const overlapPx = r.hero.b - r.next.t;
      if (pass === 1 && (kind === "last" || kind === "emptynext")) {
        const base = baselines.get(key);
        // gated off entirely: the hero is exactly the ordinary hero (same height as the no-overlap page)
        if (base !== undefined && Math.abs(r.hero.h - base) > TOL) violations.push(`${tag}: hero is ${r.hero.h.toFixed(1)}px, an ordinary hero is ${base.toFixed(1)}px`);
      }
      const expected = overlap !== "none" && kind === "picture" && w >= 768 ? PRESET[overlap] : 0;
      if (expected > 0) {
        activeChecks++;
        if (Math.abs(overlapPx - expected) > TOL) violations.push(`${tag}: overlap ${overlapPx.toFixed(1)}px, expected ${expected}px`);
        const base = baselines.get(key);
        if (base !== undefined && Math.abs(visibleHero - base) > TOL) violations.push(`${tag}: hero visible height ${visibleHero.toFixed(1)} != no-overlap hero ${base.toFixed(1)}`);
        // content never reaches the sheet
        for (const c of r.heroContent) if (c.b > r.next.t + TOL) violations.push(`${tag}: hero <${c.tag}> reaches the sheet (${c.b.toFixed(1)} > ${r.next.t.toFixed(1)})`);
        if (r.probe.hitSheet !== true) violations.push(`${tag}: the strip under the sheet hits the hero, not the sheet`);
        if (/rgba\(.*, 0\)$/.test(r.sheetBg) || r.sheetBg === "transparent") violations.push(`${tag}: the sheet is not opaque (${r.sheetBg})`);
        if (!r.active) violations.push(`${tag}: no ovlp marker though the overlap is expected`);
      } else {
        inactiveChecks++;
        if (overlapPx > TOL) violations.push(`${tag}: overlap ${overlapPx.toFixed(1)}px where none is allowed`);
      }
      keyboardChecks += 1;
      if (r.covered.length) violations.push(`${tag}: focusable elements covered: ${r.covered.join(", ")}`);
      if (pass === 1 && f === "picture.tall.md.rtl.html" && (w === 390 || w === 1280) && process.env.SHOTS) {
        await page.screenshot({ path: join(process.env.SHOTS, `${f.replace(/\.html$/, "")}.${w}.png`) });
      }
      if (pass === 1 && f === "picture.none.md.ltr.html" && w === 1280 && process.env.SHOTS) {
        await page.screenshot({ path: join(process.env.SHOTS, `${f.replace(/\.html$/, "")}.${w}.png`) });
      }
      if (pass === 1 && f === "picture.none.sm.ltr.html" && w === 768 && process.env.SHOTS) {
        await page.screenshot({ path: join(process.env.SHOTS, `${f.replace(/\.html$/, "")}.${w}.png`) });
      }
      await page.close();
    }
  }
}
await browser.close();
const summary = { ungated, pages: files.length, checks, activeOverlapChecks: activeChecks, inactiveChecks, hitTestChecks: keyboardChecks, strip, violations: violations.length, sample: violations.slice(0, 10) };
if (!strip && !ungated) writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, violations }, null, 1));
console.log(JSON.stringify(summary));
violations.slice(0, 25).forEach((v) => console.log(v));
process.exit(violations.length ? 1 : 0);
