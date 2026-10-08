// CUST-HV V6b-5 — Chromium measurement of the REAL rendered pixels behind the text.
//   node scripts/pixel-proof/measure.mjs <dir> [--shots <outDir>]
//
// For every case the PHP exporter wrote (real upload pipeline: ladder files, widened evidence bounds, publish-gate
// verdict) and every width × direction it checks, with the real storefront CSS:
//   1. DECISION PARITY — the storefront paints a picture iff the publish gate called the configuration provable
//      (an unprovable one must fall back to the legacy surface; a provable one must paint).
//   2. READABILITY — with the glyphs hidden, every pixel under the heading and the supporting line is read back and the
//      WCAG ratio of the text colour against THAT pixel is computed; the worst must be ≥ 4.5.
//   3. EVIDENCE BRACKETS PIXELS — the min/max of the rendered backdrop (picture + overlay, as composited by Chromium)
//      must lie inside the interval the bounds + overlay predict (the very interval the gate reasoned over).
//   4. LAYOUT — no horizontal overflow; the heading is the topmost element at its centre; the backdrop covers its root.
// Exit code 1 on any violation. Writes <dir>/report.json.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// `@playwright/test` is the declared dependency (pnpm does not expose a bare `playwright`)
const { chromium } = createRequire(join(root, "package.json"))("@playwright/test");

const dir = resolve(process.argv[2] ?? ".");
const shotsAt = process.argv.includes("--shots") ? resolve(process.argv[process.argv.indexOf("--shots") + 1]) : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

const WIDTHS = [390, 430, 768, 1024, 1280, 1440];
const DIRS = ["ltr", "rtl"];
const MIN_RATIO = 4.5;
const SHOT_CASES = new Set(["dusk_black-70", "snow_white-60", "street_black-70", "split_black-70", "split-left_none", "dusk+portrait_black-70", "dusk_black-40"]);

const cases = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).cases;
const slug = (id) => id.replace(/[^a-z0-9+-]+/gi, "_");

/** In-page: reads the pixels of a clip and returns per-pixel worst contrast vs the (possibly translucent) text colour. */
async function pixelStats({ b64, fg }) {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  const min = [255, 255, 255], max = [0, 0, 0]; let worst = Infinity;
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p], gg = d[p + 1], b = d[p + 2];
    for (const [k, v] of [[0, r], [1, gg], [2, b]]) { if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    if (fg) {
      const a = fg.a;
      const er = fg.r * a + r * (1 - a), eg = fg.g * a + gg * (1 - a), eb = fg.b * a + b * (1 - a);
      const l1 = L(er, eg, eb), l2 = L(r, gg, b);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < worst) worst = ratio;
    }
  }
  return { min, max, worst: fg ? worst : null, pixels: d.length / 4 };
}

// Tailwind v4 emits modern colour syntax (e.g. `color(srgb 1 1 1 / 0.8)`); the page normalises every text colour to rgba
// through a canvas, so the node side only ever parses `rgba(r, g, b, a)`.
const parseColour = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`unparseable colour: ${s}`);
  const [r, g, b, a = 1] = m[1].split(",").map((x) => Number.parseFloat(x));
  return { r, g, b, a };
};

// colour roles that resolve without a palette (the proof renders with no palette set): `overlay` → black
const ROLE_HEX = { overlay: "#000000" };
const hexRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/** The interval the gate reasons over: union of the pictures that can show, composited under the overlay. */
function predicted(c, overlayRgb, overlayAlpha) {
  const parts = [c.bounds.media, c.bounds.mobile].filter(Boolean);
  const min = [255, 255, 255], max = [0, 0, 0];
  for (const b of parts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
  if (!overlayRgb) return { min, max };
  const mix = (v, o) => v * (1 - overlayAlpha) + o * overlayAlpha;
  return { min: min.map((v, k) => mix(v, overlayRgb[k])), max: max.map((v, k) => mix(v, overlayRgb[k])) };
}

// PIXEL_PROOF_CHROMIUM: path to a Chromium binary when the installed Playwright revision differs from the browser cache
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});

// ── negative control (--control): the same measurement must FAIL on deliberately false evidence ───────────────
if (process.argv.includes("--control")) {
  let caught = 0, total = 0;
  for (const c of cases.filter((x) => !x.provable && x.files.mobile === null)) {
    for (const d of DIRS) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`file://${join(dir, "pages", `${slug(c.id)}.lie.${d}.html`)}`);
      await page.waitForLoadState("load");
      await page.evaluate(async () => { await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null)))); });
      const info = await page.evaluate(() => {
        const frame = document.querySelector("[data-sd]") ?? document.body.firstElementChild;
        const h = frame.querySelector("h1,h2"); const r = h.getBoundingClientRect();
        return { painted: !!frame.querySelector("[data-sd-backdrop]"), rect: { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }, colour: (() => { const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d", { willReadFrequently: true }); g.fillStyle = getComputedStyle(h).color; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${+(d[3] / 255).toFixed(3)})`; })() };
      });
      total += 1;
      if (!info.painted) { console.log("CONTROL", c.id, d, "not painted (bounds lie was not trusted?)"); await page.close(); continue; }
      await page.addStyleTag({ content: "h1,h2,p,a,bdi{color:transparent!important}" });
      const buf = await page.screenshot({ clip: { x: Math.max(0, Math.floor(info.rect.x)), y: Math.max(0, Math.floor(info.rect.y)), width: Math.max(1, Math.ceil(info.rect.w)), height: Math.max(1, Math.ceil(info.rect.h)) }, fullPage: true });
      const st = await page.evaluate(pixelStats, { b64: buf.toString("base64"), fg: parseColour(info.colour) });
      const failed = st.worst < MIN_RATIO;
      if (failed) caught += 1;
      console.log("CONTROL", c.id, d, `worst heading pixel contrast ${st.worst.toFixed(2)}`, failed ? "→ caught" : "→ NOT caught (picture happens to be dark there)");
      await page.close();
    }
  }
  console.log(JSON.stringify({ controlCaught: caught, controlTotal: total }));
  await browser.close();
  process.exit(caught > 0 ? 0 : 1);
}
const violations = [];
const rows = [];

for (const c of cases) {
  for (const d of DIRS) {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`file://${join(dir, "pages", `${slug(c.id)}.${d}.html`)}`);
      await page.waitForLoadState("load");
      await page.evaluate(async () => {
        await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
      });
      await page.waitForTimeout(60);

      const info = await page.evaluate(() => {
        const frame = document.querySelector("[data-sd]") ?? document.body.firstElementChild;
        const root = frame.firstElementChild?.matches?.("section") ? frame.firstElementChild : frame;
        const backdrop = frame.querySelector("[data-sd-backdrop]");
        const img = backdrop?.querySelector("img");
        const heading = frame.querySelector("h1,h2");
        const sub = frame.querySelector("p");
        const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; };
        const rgba = (css) => {
          const c = document.createElement("canvas"); c.width = c.height = 1;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.clearRect(0, 0, 1, 1); g.fillStyle = css; g.fillRect(0, 0, 1, 1);
          const d = g.getImageData(0, 0, 1, 1).data;
          return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${+(d[3] / 255).toFixed(3)})`;
        };
        const hr = heading.getBoundingClientRect();
        const top = document.elementFromPoint(hr.x + hr.width / 2, hr.y + hr.height / 2);
        const cs = getComputedStyle(frame);
        return {
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          painted: !!backdrop,
          rootBg: getComputedStyle(root).backgroundImage,
          tokens: frame.getAttribute("data-sd"),
          rootRect: rect(root),
          backRect: backdrop ? rect(backdrop) : null,
          imgSrc: img ? img.currentSrc.split("/").slice(-2).join("/") : null,
          imgLoaded: img ? img.complete && img.naturalWidth > 0 : null,
          headingOnTop: !!top && (heading.contains(top) || top === heading),
          heading: { rect: rect(heading), colour: rgba(getComputedStyle(heading).color) },
          sub: sub ? { rect: rect(sub), colour: rgba(getComputedStyle(sub).color) } : null,
          ovlRgb: cs.getPropertyValue("--sec-ovl").trim(),
          ovlA: cs.getPropertyValue("--sec-ovl-a").trim(),
          ovlBg: backdrop?.querySelector("[data-sd-overlay]") ? getComputedStyle(backdrop.querySelector("[data-sd-overlay]")).backgroundColor : null,
          ovlOpacity: backdrop?.querySelector("[data-sd-overlay]") ? getComputedStyle(backdrop.querySelector("[data-sd-overlay]")).opacity : null,
        };
      });

      if (shotsAt && SHOT_CASES.has(slug(c.id)) && ((d === "ltr" && width === 1280) || (d === "rtl" && width === 390))) {
        await page.screenshot({ path: join(shotsAt, `${slug(c.id)}.${d}.${width}.png`), clip: { x: 0, y: 0, width, height: Math.min(900, Math.ceil(info.rootRect.y + info.rootRect.h + 16)) } });
      }
      const row = { id: c.id, dir: d, width, gateProvable: c.provable, painted: info.painted, imgSrc: info.imgSrc, tokens: info.tokens };
      const fail = (why) => violations.push({ id: c.id, dir: d, width, why });

      // 4. layout
      if (info.overflow) fail("horizontal overflow");
      if (!info.headingOnTop) fail("heading is not the topmost element at its centre");
      // 1. decision parity
      if (info.painted !== c.provable) fail(`storefront painted=${info.painted} but the publish gate said provable=${c.provable}`);

      // 1b. the picture actually painted is the right one for this viewport (phone picture below 768px, else the default)
      if (info.painted) {
        const phone = width <= 767 && c.files.mobile;
        const expected = (phone ? c.files.mobile : c.files.media).map((f) => f.path);
        const shown = info.imgSrc ?? "";
        if (!expected.some((p) => p.endsWith(shown))) fail(`<picture> chose ${shown}, expected one of the ${phone ? "phone" : "default"} picture's files`);
        row.chose = phone ? "phone" : "default";
      } else {
        // 1c. a rejected configuration restores BOTH the legacy surface and the legacy text colours (no media-derived tokens)
        const tokens = (info.tokens ?? "").split(" ");
        if (tokens.includes("mbg") || tokens.includes("ovl")) fail(`rejected configuration still carries media tokens: ${info.tokens}`);
        if (!info.rootBg.includes("gradient")) fail(`rejected configuration lost the legacy surface (background-image: ${info.rootBg.slice(0, 40)})`);
        if (info.heading.colour !== "rgba(255, 255, 255, 1)") fail(`rejected configuration changed the legacy heading colour: ${info.heading.colour}`);
        await page.addStyleTag({ content: "h1,h2,p,a,bdi{color:transparent!important}a{background:transparent!important;box-shadow:none!important;border-color:transparent!important}" });
        const legacy = async (rc, fg) => {
          const buf = await page.screenshot({ clip: { x: Math.max(0, Math.floor(rc.x)), y: Math.max(0, Math.floor(rc.y)), width: Math.max(1, Math.ceil(rc.w)), height: Math.max(1, Math.ceil(rc.h)) }, fullPage: true });
          return page.evaluate(pixelStats, { b64: buf.toString("base64"), fg });
        };
        const lh = await legacy(info.heading.rect, parseColour(info.heading.colour));
        row.legacyWorstHeading = +lh.worst.toFixed(2);
        if (lh.worst < MIN_RATIO) fail(`legacy surface heading contrast ${lh.worst.toFixed(2)} < ${MIN_RATIO}`);
        if (info.sub) {
          const ls = await legacy(info.sub.rect, parseColour(info.sub.colour));
          row.legacyWorstSub = +ls.worst.toFixed(2);
          if (ls.worst < MIN_RATIO) fail(`legacy surface supporting-line contrast ${ls.worst.toFixed(2)} < ${MIN_RATIO}`);
        }
      }

      if (info.painted) {
        if (!info.imgLoaded) fail("backdrop image did not load");
        const b = info.backRect, r = info.rootRect;
        if (Math.abs(b.x - r.x) > 1 || Math.abs(b.y - r.y) > 1 || Math.abs(b.w - r.w) > 1 || Math.abs(b.h - r.h) > 1) fail("backdrop does not cover its section");

        // hide glyphs + the CTA so only the backdrop pixels remain
        await page.addStyleTag({ content: "h1,h2,p,a,bdi{color:transparent!important;text-shadow:none!important}a{background:transparent!important;box-shadow:none!important;border-color:transparent!important}" });
        const clip = (rc) => ({ x: Math.max(0, Math.floor(rc.x)), y: Math.max(0, Math.floor(rc.y)), width: Math.max(1, Math.ceil(rc.w)), height: Math.max(1, Math.ceil(rc.h)) });
        const read = async (rc, fg) => {
          const buf = await page.screenshot({ clip: clip(rc), fullPage: true });
          return page.evaluate(pixelStats, { b64: buf.toString("base64"), fg });
        };
        const hStats = await read(info.heading.rect, parseColour(info.heading.colour));
        const sStats = info.sub ? await read(info.sub.rect, parseColour(info.sub.colour)) : null;
        // 2. readability
        row.worstHeading = +hStats.worst.toFixed(2);
        if (hStats.worst < MIN_RATIO) fail(`heading worst pixel contrast ${hStats.worst.toFixed(2)} < ${MIN_RATIO}`);
        if (sStats) {
          row.worstSub = +sStats.worst.toFixed(2);
          if (sStats.worst < MIN_RATIO) fail(`supporting line worst pixel contrast ${sStats.worst.toFixed(2)} < ${MIN_RATIO}`);
        }
        // 3. evidence brackets pixels (whole backdrop, as composited)
        // inset past the section's rounded corners (14px radius): their corners show the page background, not the picture
        const inset = 18;
        const inner = { x: info.backRect.x + inset, y: info.backRect.y + inset, w: info.backRect.w - 2 * inset, h: info.backRect.h - 2 * inset };
        const all = await read(inner, null);
        // The EXPECTED overlay comes from the configuration the gate judged (`normalized`), never from the DOM under test;
        // the DOM's computed styles are then compared against it, so a renderer that paints a different strength or colour
        // than the one the gate reasoned over is a violation of its own (and cannot leak into the prediction).
        const cfg = c.normalized.overlay ?? null;
        let ovlRgb = null;
        let alpha = 0;
        if (cfg) {
          const hex = cfg.color.hex ?? ROLE_HEX[cfg.color.role];
          if (!hex) throw new Error(`no expected colour for overlay colour ${JSON.stringify(cfg.color)}`);
          ovlRgb = hexRgb(hex.toLowerCase());
          alpha = cfg.alpha / 100;
          const domBg = info.ovlBg ? parseColour(info.ovlBg) : null;
          if (!domBg || [domBg.r, domBg.g, domBg.b].some((v, k) => Math.abs(v - ovlRgb[k]) > 1)) fail(`overlay colour rendered as ${info.ovlBg}, the gate judged ${hex}`);
          if (Math.abs(Number.parseFloat(info.ovlOpacity) - alpha) > 0.005) fail(`overlay strength rendered as ${info.ovlOpacity}, the gate judged ${alpha}`);
          if (info.ovlA !== String(alpha)) fail(`--sec-ovl-a is ${info.ovlA}, the gate judged ${alpha}`);
        } else if (info.ovlBg !== null) {
          fail("an overlay is rendered although the judged configuration has none");
        }
        const pred = predicted(c, ovlRgb, alpha);
        row.rendered = { min: all.min, max: all.max };
        row.predicted = { min: pred.min.map((v) => +v.toFixed(1)), max: pred.max.map((v) => +v.toFixed(1)) };
        for (let k = 0; k < 3; k++) {
          if (all.min[k] < pred.min[k] - 1.5 || all.max[k] > pred.max[k] + 1.5) fail(`rendered channel ${k} [${all.min[k]}..${all.max[k]}] escapes the evidence-predicted [${pred.min[k].toFixed(1)}..${pred.max[k].toFixed(1)}]`);
        }
      }

      rows.push(row);
      await page.close();
    }
  }
}
await browser.close();

const painted = rows.filter((r) => r.painted);
const summary = {
  cases: cases.length,
  checks: rows.length,
  painted: painted.length,
  fellBack: rows.length - painted.length,
  worstHeading: Math.min(...painted.map((r) => r.worstHeading)),
  worstSub: Math.min(...painted.filter((r) => r.worstSub != null).map((r) => r.worstSub)),
  violations,
};
writeFileSync(join(dir, "report.json"), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify({ ...summary, violations: violations.length }, null, 1));
for (const v of violations.slice(0, 40)) console.log("VIOLATION", v.id, v.dir, v.width, v.why);
process.exit(violations.length ? 1 : 0);
