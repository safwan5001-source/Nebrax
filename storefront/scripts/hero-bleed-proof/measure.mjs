// AWJ-HERO-FULLBLEED — real-Chromium proof of the hero picture treatments (`mediaTreatment.bleed`, `ratio: natural`,
// `height` + `mobileHeight`) painted with the REAL compiled storefront stylesheet and classic (non-overlay) scrollbars:
//   * bleed: the picture reaches BOTH viewport edges (LTR and RTL), has no radius, and the hero starts directly under the
//     header (a contained hero keeps the container's top padding); the text column keeps the container's start alignment;
//   * natural: the hero's height is the picture's own proportions at the picture's width (16:9 desktop, 4:5 phone picture
//     below 768px) — nothing cropped, nothing distorted; copy taller than the picture grows the hero and is never clipped;
//   * heights: `mobileHeight` replaces `height` below 768px only (the minimum is the preset's);
//   * inert: a split hero or a hero with no picture takes none of it;
//   * nothing overflows horizontally; every CTA is hit-testable at its own centre.
// 4 viewports x AR RTL / EN LTR. `--strip` removes the new rules from the stylesheet (negative control: it must fail).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   HERO_BLEED_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/hero-bleed-proof.render.test.tsx
//   node scripts/hero-bleed-proof/measure.mjs <dir> [--strip]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary; SHOTS=<dir> saves screenshots)
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
const browser = await chromium.launch({
  ...(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {}),
  ignoreDefaultArgs: ["--hide-scrollbars"], // classic scrollbars: 100vw is wider than the page, the case a bleed must survive
});
const viewports = [[390, 844], [768, 1024], [1024, 768], [1280, 800]];
const TOL = 1.5;
const REM = 16;

let stripped = null;
if (strip) {
  const tree = postcss.parse(readFileSync(join(dir, "storefront.css"), "utf8"));
  tree.walkRules((r) => { if (/"(hbl|rat|hgtm)"/.test(r.selector)) r.remove(); });
  stripped = tree.toString();
}

const KINDS = ["control", "bleed", "bleedimg", "natural", "naturalmob", "bleedlong", "heights", "splitbleed", "nomedia"];
const BLEEDS = new Set(["bleed", "bleedimg", "bleedlong"]);
const NATURALS = new Set(["bleedimg", "natural", "naturalmob", "bleedlong"]);
const WITH_HEADING = new Set(["control", "bleed", "natural", "naturalmob", "bleedlong", "heights"]);

const measure = (page) =>
  page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const header = document.getElementById("stand-in-header");
    const stack = document.querySelector("main > *");
    const frame = stack.children[0];
    const section = frame.querySelector(":scope > section");
    const backdrop = frame.querySelector("[data-sd-backdrop]");
    const img = backdrop?.querySelector("img") ?? null;
    const heading = frame.querySelector("h1, h2");
    const content = [...frame.querySelectorAll("h1, h2, p, a")].filter((e) => !e.closest("[data-sd-backdrop]")).map(rect);
    const ctas = [...frame.querySelectorAll("a[data-hero-cta]")];
    const covered = [];
    for (const el of ctas) {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!(hit === el || el.contains(hit))) covered.push((el.textContent || "").trim());
    }
    window.scrollTo(0, 0);
    const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
    return {
      cw: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      header: rect(header), frame: rect(frame), section: rect(section), backdrop: rect(backdrop), img: rect(img),
      heading: rect(heading), content, covered,
      tokens: (frame.getAttribute("data-sd") || "").split(" "),
      sectionRadius: cs(section, "borderTopLeftRadius"), backdropRadius: cs(backdrop, "borderTopLeftRadius"),
      minHeight: cs(section, "minHeight"), objectFit: cs(img, "objectFit"),
    };
  });

const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html")).sort();
let checks = 0;
const violations = [];
const controls = new Map(); // `${dir}@${w}` -> control measurement
for (const pass of [0, 1]) {
  for (const f of files) {
    const [kind, dirName] = f.replace(/\.html$/, "").split(".");
    if ((pass === 0) !== (kind === "control")) continue;
    for (const [w, h] of viewports) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto("file://" + join(dir, "pages", f));
      if (stripped) await page.evaluate((css) => { document.querySelectorAll("style")[0].textContent = css; }, stripped);
      await page.waitForLoadState("load");
      const r = await measure(page);
      const tag = `${f}@${w}x${h}`;
      const expect = (cond, msg) => { checks++; if (!cond) violations.push(`${tag}: ${msg}`); };
      const key = `${dirName}@${w}`;
      if (kind === "control") controls.set(key, r);
      const ctl = controls.get(key);
      const rtl = dirName === "rtl";
      const startEdge = (rc) => (rtl ? rc.r : rc.l);
      const phone = w < 768;

      expect(r.overflowX <= 0, `horizontal overflow ${r.overflowX}px`);
      expect(r.covered.length === 0, `CTAs covered: ${r.covered.join(", ")}`);
      const bleeds = BLEEDS.has(kind), natural = NATURALS.has(kind);
      expect(bleeds ? r.tokens.includes("hbl") : !r.tokens.includes("hbl"), `hbl token ${bleeds ? "missing" : "present"}`);
      expect(natural ? r.tokens.includes("rat") : !r.tokens.includes("rat"), `rat token ${natural ? "missing" : "present"}`);

      if (kind === "control" || kind === "splitbleed" || kind === "nomedia") {
        // the legacy look: contained card, rounded, with the container's top padding under the header
        if (r.backdrop) expect(parseFloat(r.backdropRadius) > 0, `contained picture should keep its radius (${r.backdropRadius})`);
        expect(parseFloat(r.sectionRadius) > 0, `contained hero should keep its radius (${r.sectionRadius})`);
        expect(r.frame.t - r.header.b >= 8, `contained hero should sit below the container's top padding (gap ${(r.frame.t - r.header.b).toFixed(1)})`);
        if (r.backdrop) expect(r.backdrop.w <= r.cw - 2 * 8, `contained picture should keep side margins (${r.backdrop.w.toFixed(1)} of ${r.cw})`);
      }
      if (bleeds) {
        // edge to edge in the visible viewport, both directions, no radius, directly under the header
        expect(r.backdrop.l <= 0.5 && r.backdrop.r >= r.cw - 0.5, `picture [${r.backdrop.l.toFixed(1)}, ${r.backdrop.r.toFixed(1)}] does not reach both edges of ${r.cw}`);
        expect(parseFloat(r.backdropRadius) === 0 && parseFloat(r.sectionRadius) === 0, `radius on a bleeding hero (${r.sectionRadius}/${r.backdropRadius})`);
        expect(Math.abs(r.frame.t - r.header.b) <= 1, `hero is ${(r.frame.t - r.header.b).toFixed(1)}px from the header, expected flush`);
        expect(Math.abs(r.backdrop.t - r.section.t) <= 1 && Math.abs(r.backdrop.b - r.section.b) <= 1, `picture does not fill the hero's height`);
      }
      if (WITH_HEADING.has(kind) && r.heading && ctl?.heading && kind !== "heights") {
        // the text column keeps the container's start alignment (a bleed moves the picture, not the copy)
        expect(Math.abs(startEdge(r.heading) - startEdge(ctl.heading)) <= 1, `heading start ${startEdge(r.heading).toFixed(1)} != contained ${startEdge(ctl.heading).toFixed(1)}`);
        expect(r.heading.l >= 0 && r.heading.r <= r.cw, `heading [${r.heading.l.toFixed(1)}, ${r.heading.r.toFixed(1)}] leaves the viewport`);
      }
      if (natural) {
        const ratio = kind === "naturalmob" && phone ? 1000 / 800 : 900 / 1600;
        const expected = r.backdrop.w * ratio;
        const grown = kind === "bleedlong";
        if (grown) {
          expect(r.section.h >= expected - TOL, `hero ${r.section.h.toFixed(1)} is shorter than its picture ${expected.toFixed(1)}`);
          for (const c of r.content) expect(c.t >= r.section.t - 0.5 && c.b <= r.section.b + 0.5, `copy [${c.t.toFixed(1)}, ${c.b.toFixed(1)}] clipped by hero [${r.section.t.toFixed(1)}, ${r.section.b.toFixed(1)}]`);
          expect(r.img.h >= r.section.h - TOL, `picture ${r.img.h.toFixed(1)} leaves a gap in the grown hero ${r.section.h.toFixed(1)}`);
        } else {
          expect(Math.abs(r.section.h - expected) <= TOL, `hero ${r.section.h.toFixed(1)}px, natural ${expected.toFixed(1)}px (${(ratio).toFixed(4)} x ${r.backdrop.w.toFixed(1)})`);
          expect(Math.abs(r.img.w / r.img.h - 1 / ratio) <= 0.02, `picture is distorted: ${(r.img.w / r.img.h).toFixed(3)} vs ${(1 / ratio).toFixed(3)}`);
        }
        expect(Math.abs(r.img.w - r.backdrop.w) <= 1, `picture ${r.img.w.toFixed(1)} is not as wide as its frame ${r.backdrop.w.toFixed(1)}`);
        expect(r.objectFit === "cover", `object-fit ${r.objectFit}`);
        if (!bleeds) expect(Math.abs(r.backdrop.w - r.section.w) <= 1, `contained natural picture ${r.backdrop.w.toFixed(1)} != hero width ${r.section.w.toFixed(1)}`);
      }
      if (kind === "heights") {
        const want = phone ? 10 * REM : 28 * REM;
        expect(parseFloat(r.minHeight) === want, `min-height ${r.minHeight}, expected ${want}px at ${w}px`);
        expect(r.section.h >= want - 0.5, `hero ${r.section.h.toFixed(1)}px is below its ${want}px minimum`);
      }
      if (pass === 1 && process.env.SHOTS && ["bleedimg.ltr@1280", "bleedimg.rtl@390", "bleed.ltr@768", "control.ltr@1280", "bleedlong.rtl@390", "naturalmob.ltr@390"].includes(`${kind}.${dirName}@${w}`)) {
        await page.screenshot({ path: join(process.env.SHOTS, `${kind}.${dirName}.${w}.png`) });
      }
      if (pass === 0 && process.env.SHOTS && key === "ltr@1280") await page.screenshot({ path: join(process.env.SHOTS, `control.ltr.1280.png`) });
      await page.close();
    }
  }
}
await browser.close();
const summary = { pages: files.length, viewports: viewports.length, checks, strip, violations: violations.length, sample: violations.slice(0, 5) };
if (!strip) writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, violations }, null, 1));
console.log(JSON.stringify(summary));
violations.slice(0, 30).forEach((v) => console.log(v));
process.exit(violations.length ? 1 : 0);
