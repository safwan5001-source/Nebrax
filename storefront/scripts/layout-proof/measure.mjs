// CUST-HV V6c-7 — real-Chromium proof of the hero (centered | minimal | split) and banner (split | text-band) layout variants:
//   hero centered  : the content box and its text sit in the middle, the button row too;
//   hero minimal   : the subheadline is gone, the hero is shorter than the default one;
//   hero split     : from 768 px the overlay covers ONLY the inline-start half (logically: the right half under RTL), the text column
//                    stays inside that half, the other half's picture is bare (brighter); on a phone nothing changes;
//   banner text-band: the picture is hidden, the band is slimmer, and from 768 px the copy and the buttons share a row;
//   banner split   : from 768 px the picture fills the inline-end half edge to edge, the copy the other half; stacked on a phone;
//   ALL            : no horizontal overflow, buttons keep their tap height, and — the contrast proof — on a picture hero the pixels
//                    that really sit behind the heading and the buttons give the foreground >= 4.5:1 (text and borders hidden,
//                    the background photographed), whatever the layout and viewport.
// 6 viewports x AR RTL / EN LTR. `--strip` removes the layout rules from the stylesheet (negative control: it must fail).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   LAYOUT_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/layout-proof.render.test.tsx
//   node scripts/layout-proof/measure.mjs <dir> [--strip]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
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
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const TOL = 2;
const BANNER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#7a8b9c"/><circle cx="400" cy="250" r="140" fill="#c9d3dc"/></svg>';
let stripped = null;
if (strip) {
  const parsed = postcss.parse(readFileSync(join(dir, "storefront.css"), "utf8"));
  parsed.walkRules((r) => { if (/\[data-sd~="?(lctr|lmin|lsplit|lband|lbsplit)"?\]/.test(r.selector)) r.remove(); });
  stripped = parsed.toString();
}
const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html")).sort();
const violations = [];
let checks = 0, layoutChecks = 0, pixelChecks = 0;
const baselines = new Map(); // `${type}.${kind}.${dir}@${w}` -> measurements of the default layout

const measure = (page) =>
  page.evaluate(() => {
    const section = document.querySelector("main section");
    const content = section.querySelector("[data-section-content]") ?? section.firstElementChild;
    const heading = section.querySelector("h1, h2");
    const sub = [...section.querySelectorAll("p")][0] ?? null;
    const overlay = section.querySelector("[data-sd-overlay]");
    const img = content.querySelector(":scope > img");
    const copy = content.querySelector(":scope > div");
    const links = [...section.querySelectorAll("a")];
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      s: r(section), c: r(content), heading: r(heading), headingColor: getComputedStyle(heading).color,
      sub: sub ? { rect: r(sub), display: getComputedStyle(sub).display } : null,
      overlay: r(overlay), img: img ? { rect: r(img), display: getComputedStyle(img).display } : null,
      copy: r(copy), links: links.map(r), textAlign: getComputedStyle(content).textAlign,
      copyPad: copy ? getComputedStyle(copy).padding : null, contentDisplay: getComputedStyle(content).display,
      frameTokens: section.parentElement?.getAttribute("data-sd") ?? "",
    };
  });

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lumOf = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const parseRgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const pixelsContrast = (page, dataUrl, fg) =>
  page.evaluate(async ({ dataUrl, fg }) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (a, b, e) => 0.2126 * lin(a) + 0.7152 * lin(b) + 0.0722 * lin(e);
    const L = lum(fg[0], fg[1], fg[2]);
    let worst = Infinity, sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const P = lum(d[i], d[i + 1], d[i + 2]); sum += P; n++;
      const [hi, lo] = L > P ? [L, P] : [P, L];
      worst = Math.min(worst, (hi + 0.05) / (lo + 0.05));
    }
    return { worst, mean: sum / n };
  }, { dataUrl, fg });

for (const pass of [0, 1]) { // pass 0: default-layout baselines, pass 1: the variants
  for (const f of files) {
    const [type, kind, layout, dirName] = f.replace(/\.html$/, "").split(".");
    if ((pass === 0) !== (layout === "none")) continue;
    const rtl = dirName === "rtl";
    for (const [w, h] of viewports) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.route("https://example.invalid/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: BANNER_SVG }));
      await page.goto("file://" + join(dir, "pages", f));
      if (stripped) await page.evaluate((css) => { document.querySelectorAll("style")[0].textContent = css; }, stripped);
      await page.waitForLoadState("load");
      const m = await measure(page);
      checks++;
      const tag = `${f}@${w}x${h}`;
      const key = `${type}.${kind}.${dirName}@${w}`;
      if (pass === 0) baselines.set(key, m);
      const base = baselines.get(key);
      if (m.overflowX > 0) violations.push(`${tag}: horizontal overflow ${m.overflowX}`);
      const start = (rect) => (rtl ? m.s.r - rect.r : rect.l - m.s.l); // distance from the inline-start edge
      const end = (rect) => (rtl ? rect.l - m.s.l : m.s.r - rect.r);
      const wide = w >= 768;
      layoutChecks++;
      if (type === "hero" && layout === "centered") {
        const cs = start(m.c), ce = end(m.c);
        if (m.c.w < m.s.w - 8 && Math.abs(cs - ce) > TOL) violations.push(`${tag}: content box not centred (${cs.toFixed(1)} vs ${ce.toFixed(1)})`);
        if (m.textAlign !== "center") violations.push(`${tag}: text-align ${m.textAlign}`);
        const lo = Math.min(...m.links.map((l) => l.l)), hi = Math.max(...m.links.map((l) => l.r));
        if (Math.abs((lo + hi) / 2 - (m.c.l + m.c.r) / 2) > 6) violations.push(`${tag}: button row not centred in its box`);
      }
      if (type === "hero" && layout === "minimal") {
        if (m.sub && m.sub.display !== "none") violations.push(`${tag}: the subheadline is still shown`);
        if (base && !(m.s.h < base.s.h - 4)) violations.push(`${tag}: minimal hero (${m.s.h.toFixed(0)}px) is not shorter than the default (${base.s.h.toFixed(0)}px)`);
      }
      if (type === "hero" && layout === "split" && kind.startsWith("picture")) {
        if (!m.overlay) violations.push(`${tag}: no overlay element`);
        else if (wide) {
          if (Math.abs(m.overlay.w - m.s.w / 2) > TOL) violations.push(`${tag}: overlay ${m.overlay.w.toFixed(1)}px is not half of ${m.s.w.toFixed(1)}px`);
          if (start(m.overlay) > TOL) violations.push(`${tag}: overlay is not on the inline-start edge`);
          if (end(m.c) < m.s.w / 2 - TOL) violations.push(`${tag}: the text column crosses the middle (${end(m.c).toFixed(1)} < ${(m.s.w / 2).toFixed(1)})`);
          for (const l of m.links) if (end(l) < m.s.w / 2 - TOL) violations.push(`${tag}: a button crosses the middle`);
        } else if (Math.abs(m.overlay.w - m.s.w) > TOL) violations.push(`${tag}: on a phone the overlay must stay full width (${m.overlay.w.toFixed(1)} of ${m.s.w.toFixed(1)})`);
      }
      if (type === "banner" && kind === "noimage" && layout === "split") {
        // nothing to split: the banner stays exactly as the default (no stray padding, same layout box)
        if (base && m.copyPad !== base.copyPad) violations.push(`${tag}: a banner with no picture gained padding (${m.copyPad} vs ${base.copyPad})`);
        if (base && m.contentDisplay !== base.contentDisplay) violations.push(`${tag}: a banner with no picture changed its layout box (${m.contentDisplay})`);
      }
      if (type === "banner" && kind === "imageonly" && layout === "text-band") {
        if (!m.img || m.img.display === "none") violations.push(`${tag}: a picture-only banner lost its only content`);
        else if (m.img.rect.h < 30) violations.push(`${tag}: the picture-only banner collapsed (${m.img.rect.h.toFixed(0)}px)`);
      }
      if (type === "banner" && kind === "inner" && layout === "split" && wide) {
        // the explicit inner spacing replaces the preset's padding on the copy; a gutter between the halves remains
        if (!/^0px( 0px){0,3}$/.test(m.copyPad ?? "")) violations.push(`${tag}: explicit inner spacing none left padding on the copy (${m.copyPad})`);
        const gap = rtl ? m.copy.l - (m.img.rect.r) : m.img.rect.l - m.copy.r;
        if (m.img && m.copy && gap < 12) violations.push(`${tag}: no gutter between the copy and the picture (${gap.toFixed(1)}px)`);
      }
      if (type === "banner" && kind === "nocta" && layout === "text-band" && wide && m.sub && m.heading) {
        // no button: the subtitle stays stacked under the heading in the same column (never beside it)
        if (!(m.sub.rect.t >= m.heading.b - 2)) violations.push(`${tag}: the subtitle is not under the heading (${m.sub.rect.t.toFixed(0)} < ${m.heading.b.toFixed(0)})`);
        if (Math.abs(start(m.sub.rect) - start(m.heading)) > 2) violations.push(`${tag}: the subtitle is not in the heading's column`);
      }
      if (type === "banner" && kind === "lone" && layout === "text-band") {
        if (m.img && m.img.display !== "none") violations.push(`${tag}: a banner with a single button keeps its picture under text-band`);
      }
      if (type === "banner" && kind === "plain" && layout === "text-band") {
        if (m.img && m.img.display !== "none") violations.push(`${tag}: the picture is not hidden`);
        if (base && !(m.s.h < base.s.h - 4)) violations.push(`${tag}: band (${m.s.h.toFixed(0)}px) is not slimmer than the card (${base.s.h.toFixed(0)}px)`);
        if (wide && m.copy) {
          const t = m.heading, b = m.links[0];
          if (!(start(b) > start(t) + t.w - TOL) && !(b.t > t.b - 2)) violations.push(`${tag}: buttons do not share the row with the copy`);
          if (b.t > t.b + 4 && b.b > m.copy.b + 2) violations.push(`${tag}: buttons wrap below the copy`);
          const lastLink = m.links[m.links.length - 1];
          // the buttons are pushed to the inline-end edge of the band (inside its padding), not left hugging the title
          if (end(lastLink) > 40) violations.push(`${tag}: the buttons are not at the inline end of the band (gap ${end(lastLink).toFixed(1)})`);
        }
      }
      if (type === "banner" && kind === "plain" && layout === "split") {
        if (wide && m.img) {
          if (m.img.display === "none") violations.push(`${tag}: picture hidden`);
          if (Math.abs(m.img.rect.w - m.s.w / 2) > 4) violations.push(`${tag}: picture ${m.img.rect.w.toFixed(1)}px is not half of ${m.s.w.toFixed(1)}px`);
          if (end(m.img.rect) > 2) violations.push(`${tag}: picture is not on the inline-end edge (gap ${end(m.img.rect).toFixed(1)})`);
          if (end(m.copy) < m.s.w / 2 - 4) violations.push(`${tag}: the copy crosses the middle`);
          if (m.img.rect.h < m.s.h - 4) violations.push(`${tag}: picture does not fill the card height (${m.img.rect.h.toFixed(0)} of ${m.s.h.toFixed(0)})`);
        } else if (m.img && base?.img && Math.abs(m.img.rect.w - base.img.rect.w) > 2) violations.push(`${tag}: on a phone the banner must stay stacked as the default`);
      }
      // tap height of the buttons
      for (const l of m.links) {
        const min = type === "banner" ? 40 : w >= 768 ? 44 : 36;
        if (l.h < min - 0.5) violations.push(`${tag}: a button is ${l.h.toFixed(1)}px < ${min}px`);
      }
      // the contrast proof on a picture hero: pixels really behind the heading and the buttons
      if (type === "hero" && kind.startsWith("picture")) {
        const fg = parseRgb(m.headingColor);
        const boxes = [m.heading, ...m.links];
        for (let i = 0; i < boxes.length; i++) {
          const box = boxes[i];
          const el = i === 0 ? page.locator("main section h1, main section h2").first() : page.locator("main section a").nth(i - 1);
          await el.evaluate((n) => { n.style.setProperty("color", "transparent", "important"); n.style.setProperty("border-color", "transparent", "important"); n.style.setProperty("background", "transparent", "important"); n.style.setProperty("text-decoration-color", "transparent", "important"); });
          const bb = await el.boundingBox();
          const png = await page.screenshot({ clip: { x: Math.max(0, bb.x), y: Math.max(0, bb.y), width: Math.max(1, Math.min(bb.width, w - bb.x)), height: bb.height }, type: "png" });
          const res = await pixelsContrast(page, "data:image/png;base64," + png.toString("base64"), i === 0 ? fg : [255, 255, 255]);
          pixelChecks++;
          if (i === 0 && res.worst < 4.5 - 0.1) violations.push(`${tag}: heading over its real pixels gives ${res.worst.toFixed(2)}:1`);
        }
        if (layout === "split" && wide && m.overlay) {
          // the bare half is brighter than the overlaid half (the picture is not dimmed where no text sits)
          const half = m.s.w / 2;
          const clipFor = (fromStart) => ({ x: rtl ? (fromStart ? m.s.l + half : m.s.l) : (fromStart ? m.s.l : m.s.l + half), y: m.s.t + 4, width: half, height: Math.min(40, m.s.h - 8) });
          const text = await page.screenshot({ clip: clipFor(true), type: "png" });
          const bare = await page.screenshot({ clip: clipFor(false), type: "png" });
          const a = await pixelsContrast(page, "data:image/png;base64," + text.toString("base64"), [255, 255, 255]);
          const b = await pixelsContrast(page, "data:image/png;base64," + bare.toString("base64"), [255, 255, 255]);
          pixelChecks++;
          if (!(b.mean > a.mean)) violations.push(`${tag}: the picture half is not brighter than the overlaid text half (${b.mean.toFixed(4)} vs ${a.mean.toFixed(4)})`);
        }
      }
      await page.close();
    }
  }
}
await browser.close();
const summary = { pages: files.length, checks, layoutChecks, pixelChecks, strip, violations: violations.length, sample: violations.slice(0, 10) };
if (!strip) writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, violations }, null, 1));
console.log(JSON.stringify(summary));
violations.slice(0, 30).forEach((v) => console.log(v));
process.exit(violations.length ? 1 : 0);
