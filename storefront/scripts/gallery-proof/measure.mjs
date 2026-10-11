// CUST-HV V8e — real-Chromium proof of the published gallery (production `publishedNodes` → `resolveGallery` → `HomeGallery` markup + the compiled
// storefront stylesheet + the REAL client component mounted by scripts/gallery-proof/mount.tsx, viewer included). For every page (8 configurations)
// in AR RTL / EN LTR at 390 / 430 / 768 / 1024 / 1280 / 1440 it checks:
//   LAYOUT     no horizontal overflow · the visible column count is 2 on phones, the tablet cap (4→3, 6→4) from 640 px and the authored count from
//              1024 px · the gap is the authored step · every frame has the authored aspect ratio and its picture fills it (cover / contain as
//              authored) · the first item sits on the inline-start edge · every picture decodes · captions stay inside their item (an unbroken
//              word wraps) · captions are readable (≥ 4.5 : 1) against the surface they sit on, designed or not
//   CAROUSEL   a native scroll-snap strip · its previous / next buttons exist only when it overflows, sit on the logical edges (mirrored under
//              RTL), are ≥ 44 px, `aria-disabled` at the ends, and move the strip toward the inline-end edge (negative scrollLeft in RTL)
//   NO-JS      with JavaScript disabled the static markup alone is the same grid / strip, with no button at all and an anchor to the large picture
//   VIEWER     a click opens a modal dialog covering the viewport with focus on Close · the picture fits the viewport · Close sits on the inline-end
//              edge, previous / next on their logical edges · ← / → follow the VISUAL direction · Tab / Shift+Tab cycle inside · Esc and a
//              backdrop press close it, the scroll lock is released and focus returns to the picture that opened it · no overflow while open · an
//              image with its own link is a link, never an opener
//   MOTION     with prefers-reduced-motion nothing transitions and the hover zoom is off; with motion the hover zoom is on
// Negative controls (each must make this script FAIL): --physical (physical left / right on the buttons) · --wrongcols (a wrong desktop column
// count) · --noreduce (reduced-motion rules removed) · --swapkeys (arrow keys not following the visual direction) · --notrap (no focus trap).
//   node scripts/pixel-proof/build-css.mjs <dir>; node scripts/slider-proof/make-pictures.mjs <dir>
//   GALLERY_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/gallery-proof.render.test.tsx
//   node scripts/gallery-proof/measure.mjs <dir> [--physical|--wrongcols|--noreduce|--swapkeys|--notrap] [--pages a,b] [--shots <outDir>]   (PIXEL_PROOF_CHROMIUM=<path>)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");
const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
const esbuild = createRequire(join(root, "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/"))("esbuild");

const dir = resolve(process.argv[2]);
const flag = (f) => process.argv.includes(f);
const shotsAt = flag("--shots") ? resolve(process.argv[process.argv.indexOf("--shots") + 1]) : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

let bundle = esbuild.buildSync({
  entryPoints: [join(root, "scripts/gallery-proof/mount.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@": join(root, "src"), "next/dynamic": join(root, "scripts/gallery-proof/dynamic-shim.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, absWorkingDir: root,
}).outputFiles[0].text;
if (flag("--swapkeys")) bundle = bundle.replace('visualRight === (dir === "ltr")', 'visualRight === (dir === "rtl")');
if (flag("--notrap")) bundle = bundle.replace('if (event.key === "Tab") {', "if (false) {");
writeFileSync(join(dir, "mount.js"), bundle);

let css = readFileSync(join(dir, "storefront.css"), "utf8");
if (flag("--physical")) css = css.replace(/inset-inline-start:\s*0\.5rem/g, "left: 0.5rem").replace(/inset-inline-end:\s*0\.5rem/g, "right: 0.5rem").replace(/inset-inline-start:\s*0\.75rem/g, "left: 0.75rem").replace(/inset-inline-end:\s*0\.75rem/g, "right: 0.75rem");
if (flag("--wrongcols")) css = css.replace(/--ga-n:\s*var\(--ga-cols-d\)/g, "--ga-n: 3");
if (flag("--noreduce")) {
  const parsed = postcss.parse(css);
  parsed.walkAtRules("media", (a) => { if (/prefers-reduced-motion/.test(a.params)) a.remove(); });
  css = parsed.toString();
}
const inlineCss = (html) => html.replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`);

const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const VIEWPORTS = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const VIEWER_WIDTHS = new Set([390, 768, 1280]);
const ONLY = flag("--pages") ? process.argv[process.argv.indexOf("--pages") + 1].split(",") : null;
// name → authored { cols, gap px, aspect w/h, carousel, viewer, count, captions, designed }
const SPEC = {
  grid3: { cols: 3, gap: 16, ar: 1, count: 6, captions: true },
  grid6: { cols: 6, gap: 8, ar: 4 / 3, count: 12, captions: true },
  grid2: { cols: 2, gap: 32, ar: 4 / 5, count: 5, captions: true, long: 1 },
  contain: { cols: 3, gap: 0, ar: 16 / 9, count: 4, captions: false, contain: [0, 2] },
  strip: { cols: 4, gap: 16, ar: 1, count: 8, captions: true, carousel: true },
  viewer: { cols: 3, gap: 16, ar: 1, count: 6, captions: true, viewer: true, linked: 3 },
  viewerStrip: { cols: 4, gap: 16, ar: 1, count: 7, captions: true, carousel: true, viewer: true },
  designed: { cols: 3, gap: 16, ar: 1, count: 6, captions: true, designed: true },
};
const PAGES = Object.keys(SPEC).filter((n) => !ONLY || ONLY.includes(n));
const violations = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) violations.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a]; return (lum(hi) + 0.05) / (lum(lo) + 0.05); };
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const expectedCols = (vw, cols) => (vw >= 1024 ? cols : vw >= 640 ? (cols === 6 ? 4 : cols === 4 ? 3 : cols) : 2);

const snap = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 }; };
  const rootEl = document.querySelector("[data-gallery]");
  const list = document.querySelector("[data-gallery-list]");
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.99)) return c; } return "rgb(255,255,255)"; };
  const items = [...document.querySelectorAll("[data-gallery-item]")].map((it, i) => {
    const frame = it.querySelector("[data-gallery-frame]");
    const img = it.querySelector("img");
    const cap = it.querySelector("figcaption");
    const a = it.querySelector("a");
    return {
      i, rect: r(it), frame: r(frame), img: r(img), fit: frame?.dataset.fit, objFit: img ? getComputedStyle(img).objectFit : null, objPos: img ? getComputedStyle(img).objectPosition : null,
      loaded: !!img && img.complete && img.naturalWidth > 0, alt: img?.getAttribute("alt"),
      cap: cap ? { ...r(cap), color: getComputedStyle(cap).color, bg: bgOf(cap), over: cap.scrollWidth - cap.clientWidth } : null,
      a: a ? { open: a.getAttribute("data-gallery-open"), link: a.hasAttribute("data-gallery-link"), href: a.getAttribute("href"), label: a.getAttribute("aria-label") } : null,
      imgTransition: img ? getComputedStyle(img).transitionDuration : null,
    };
  });
  const prev = document.querySelector('[data-gallery-arrow="previous"]'), next = document.querySelector('[data-gallery-arrow="next"]');
  return {
    vw: window.innerWidth, vh: window.innerHeight, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    root: r(rootEl), dir: rootEl.getAttribute("dir"), layout: rootEl.dataset.layout, list: r(list),
    listScroll: { sw: list.scrollWidth, cw: list.clientWidth, left: list.scrollLeft, snap: getComputedStyle(list).scrollSnapType },
    items, prev: prev ? { ...r(prev), disabled: prev.getAttribute("aria-disabled") } : null, next: next ? { ...r(next), disabled: next.getAttribute("aria-disabled") } : null,
    buttons: document.querySelectorAll("button").length,
  };
});
const viewerSnap = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 }; };
  const d = document.querySelector("[data-gallery-viewer]");
  if (!d) return null;
  const img = d.querySelector("img");
  return {
    role: d.getAttribute("role"), modal: d.getAttribute("aria-modal"), label: d.getAttribute("aria-label"), dir: d.getAttribute("dir"), rect: r(d),
    img: r(img), loaded: !!img && img.complete && img.naturalWidth > 0, cap: r(d.querySelector("figcaption")), count: d.querySelector("[data-gallery-viewer-count]")?.textContent ?? "",
    close: r(d.querySelector("[data-gallery-viewer-close]")), prev: r(d.querySelector('[data-gallery-viewer-nav="previous"]')), next: r(d.querySelector('[data-gallery-viewer-nav="next"]')),
    focus: document.activeElement?.getAttribute("data-gallery-viewer-close") !== null ? "close" : document.activeElement?.getAttribute("data-gallery-viewer-nav") ?? (d.contains(document.activeElement) ? "inside" : "outside"),
    htmlOverflow: getComputedStyle(document.documentElement).overflow, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

for (const name of PAGES) {
  const spec = SPEC[name];
  for (const dir of ["ltr", "rtl"]) {
    const rtl = dir === "rtl";
    const file = join(dir === "rtl" ? "" : "", "pages", `${name}.${dir}.html`);
    const path = join(globalThis.__dir ?? process.argv[2], file);
    writeFileSync(path, inlineCss(readFileSync(path, "utf8")));
    for (const [w, h] of VIEWPORTS) {
      const tag = `${name}.${dir}@${w}`;
      const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "no-preference" });
      const page = await context.newPage();
      await page.goto(`file://${path}`);
      await page.waitForSelector("[data-gallery-root]");
      await page.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = "eager"; return i.decode().catch(() => {}); })));
      if (spec.carousel) await page.waitForTimeout(150);
      const s = await snap(page);
      const n = expectedCols(w, spec.cols);

      // ── layout
      ok(s.overflowX <= 0, `${tag}: horizontal overflow ${s.overflowX}`);
      ok(s.dir === dir, `${tag}: gallery dir ${s.dir}`);
      ok(s.items.length === spec.count, `${tag}: ${s.items.length} items, wanted ${spec.count}`);
      ok(s.items.every((it) => it.loaded), `${tag}: a picture did not decode`);
      ok(s.items.every((it) => near(it.frame.w / it.frame.h, spec.ar, 0.02)), `${tag}: frame aspect ${s.items.map((it) => (it.frame.w / it.frame.h).toFixed(2)).join(",")} ≠ ${spec.ar.toFixed(3)}`);
      ok(s.items.every((it) => near(it.img.w, it.frame.w, 1) && near(it.img.h, it.frame.h, 1)), `${tag}: a picture does not fill its frame`);
      s.items.forEach((it) => {
        const wantFit = spec.contain?.includes(it.i) ? "contain" : "cover";
        ok(it.objFit === wantFit, `${tag}: item ${it.i} object-fit ${it.objFit} ≠ ${wantFit}`);
        if (name === "contain") ok(it.objPos.startsWith("20%") || /^\d/.test(it.objPos), `${tag}: object-position ${it.objPos}`);
      });
      // first item on the inline-start edge
      const first = s.items[0].rect, second = s.items[1].rect;
      ok(rtl ? first.r >= second.r - 1 && near(first.r, s.list.r, 2) : first.l <= second.l + 1 && near(first.l, s.list.l, 2), `${tag}: the first item is not on the inline-start edge`);
      if (!spec.carousel) {
        const lefts = [...new Set(s.items.map((it) => Math.round(it.rect.l)))];
        ok(lefts.length === Math.min(n, spec.count), `${tag}: ${lefts.length} columns, wanted ${Math.min(n, spec.count)}`);
        if (spec.count > 1) {
          const rowGap = rtl ? first.l - second.r : second.l - first.r;
          // second item is beside the first only when there is more than one column
          if (n > 1) ok(near(Math.abs(rtl ? first.l - second.r : second.l - first.r), spec.gap, 1.5), `${tag}: gap ${rowGap.toFixed(1)} ≠ ${spec.gap}`);
        }
      } else {
        const expectW = (s.list.w - (n - 1) * spec.gap) / n;
        ok(near(s.items[0].rect.w, expectW, 1.5), `${tag}: strip item width ${s.items[0].rect.w.toFixed(1)} ≠ ${expectW.toFixed(1)}`);
        ok(/x/.test(s.listScroll.snap) && /mandatory/.test(s.listScroll.snap), `${tag}: scroll-snap ${s.listScroll.snap}`);
        const overflowing = spec.count > n;
        ok((s.listScroll.sw > s.listScroll.cw + 2) === overflowing, `${tag}: strip overflow ${s.listScroll.sw}/${s.listScroll.cw} vs ${overflowing}`);
        // controls exist iff it overflows, on the logical edges, ≥ 44 px
        ok(!!s.prev === overflowing && !!s.next === overflowing, `${tag}: arrows present ${!!s.prev}/${!!s.next}, overflow ${overflowing}`);
        if (overflowing && s.prev && s.next) {
          ok(rtl ? s.prev.cx > s.next.cx : s.prev.cx < s.next.cx, `${tag}: previous / next are not on the logical edges`);
          ok(s.prev.w >= 44 && s.prev.h >= 44 && s.next.w >= 44 && s.next.h >= 44, `${tag}: arrows below 44 px`);
          ok(s.prev.disabled === "true" && s.next.disabled === "false", `${tag}: arrow states at the start ${s.prev.disabled}/${s.next.disabled}`);
          await page.click('[data-gallery-arrow="next"]');
          await page.waitForTimeout(700);
          const moved = await page.evaluate(() => document.querySelector("[data-gallery-list]").scrollLeft);
          ok(rtl ? moved < -4 : moved > 4, `${tag}: next moved the strip to ${moved} (should travel toward the inline-end edge)`);
          // to the end
          for (let k = 0; k < 12; k++) { const d = await page.getAttribute('[data-gallery-arrow="next"]', "aria-disabled"); if (d === "true") break; await page.click('[data-gallery-arrow="next"]'); await page.waitForTimeout(450); }
          ok((await page.getAttribute('[data-gallery-arrow="next"]', "aria-disabled")) === "true", `${tag}: next is not disabled at the end`);
          await page.click('[data-gallery-arrow="previous"]');
          await page.waitForTimeout(600);
          ok((await page.getAttribute('[data-gallery-arrow="next"]', "aria-disabled")) === "false", `${tag}: previous did not leave the end`);
        }
      }
      // captions
      if (spec.captions) {
        s.items.forEach((it) => {
          ok(!!it.cap, `${tag}: item ${it.i} lost its caption`);
          if (!it.cap) return;
          ok(it.cap.l >= it.rect.l - 1 && it.cap.r <= it.rect.r + 1, `${tag}: caption ${it.i} leaves its item`);
          ok(it.cap.over <= 1, `${tag}: caption ${it.i} overflows by ${it.cap.over}`);
          ok(ratio(rgb(it.cap.color), rgb(it.cap.bg)) >= 4.5, `${tag}: caption ${it.i} ${it.cap.color} on ${it.cap.bg} = ${ratio(rgb(it.cap.color), rgb(it.cap.bg)).toFixed(2)}`);
        });
      } else {
        ok(s.items.every((it) => !it.cap), `${tag}: a caption is drawn though captions are off`);
      }
      // openers / links
      s.items.forEach((it) => {
        if (spec.viewer && it.i === spec.linked) ok(it.a?.link && it.a.open === null, `${tag}: the linked image must stay a link`);
        else if (spec.viewer) ok(it.a?.open === String(it.i) && /\/pics\/|\.png$/.test(it.a.href), `${tag}: item ${it.i} is not an opener to the picture file (${JSON.stringify(it.a)})`);
        else ok(!it.a, `${tag}: an inert gallery has an anchor`);
      });

      // ── focus ring on the first anchor
      if (spec.viewer) {
        await page.focus("a[data-gallery-open]");
        await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
        const ring = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { style: c.outlineStyle, width: Number.parseFloat(c.outlineWidth) }; });
        ok(ring.style !== "none" && ring.width >= 2, `${tag}: no focus ring on a picture anchor ${JSON.stringify(ring)}`);
      }

      // ── viewer
      if (spec.viewer && VIEWER_WIDTHS.has(w)) {
        const opener = 'a[data-gallery-open="1"]';
        const total = spec.count - (spec.linked !== undefined ? 0 : 0);
        await page.locator(opener).scrollIntoViewIfNeeded();
        await page.click(opener);
        await page.waitForSelector("[data-gallery-viewer]");
        await page.waitForTimeout(150);
        const v = await viewerSnap(page);
        ok(v.role === "dialog" && v.modal === "true", `${tag}: viewer is not a modal dialog`);
        ok(v.dir === dir, `${tag}: viewer dir ${v.dir}`);
        ok(near(v.rect.l, 0, 1) && near(v.rect.t, 0, 1) && near(v.rect.w, w, 1) && near(v.rect.h, h, 1), `${tag}: viewer does not cover the viewport`);
        ok(v.focus === "close", `${tag}: focus is on ${v.focus}, not Close`);
        ok(v.htmlOverflow === "hidden", `${tag}: the page is not scroll-locked (${v.htmlOverflow})`);
        ok(v.loaded && v.img.l >= -1 && v.img.r <= w + 1 && v.img.t >= -1 && v.img.b <= h + 1, `${tag}: the picture does not fit the viewport ${JSON.stringify(v.img)}`);
        ok(!!v.cap && v.cap.b <= h + 1 && v.cap.l >= -1 && v.cap.r <= w + 1, `${tag}: caption outside the viewport`);
        ok(v.overflowX <= 0, `${tag}: horizontal overflow while open ${v.overflowX}`);
        ok(new RegExp(`^2\\D+${spec.count}$`).test(v.count.trim()), `${tag}: counter "${v.count}"`);
        ok(rtl ? v.close.cx < w / 2 : v.close.cx > w / 2, `${tag}: Close is not on the inline-end edge`);
        ok(rtl ? v.prev.cx > w / 2 && v.next.cx < w / 2 : v.prev.cx < w / 2 && v.next.cx > w / 2, `${tag}: viewer previous / next are not on the logical edges`);
        ok([v.close, v.prev, v.next].every((b) => b.w >= 44 && b.h >= 44), `${tag}: viewer buttons below 44 px`);
        // arrows follow the visual direction
        await page.keyboard.press("ArrowRight");
        const afterRight = (await viewerSnap(page)).count.trim();
        ok(rtl ? /^1\D/.test(afterRight) : /^3\D/.test(afterRight), `${tag}: → gave "${afterRight}"`);
        await page.keyboard.press("ArrowLeft");
        ok(/^2\D/.test((await viewerSnap(page)).count.trim()), `${tag}: ← did not return`);
        // focus trap
        await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
        ok((await viewerSnap(page)).focus !== "outside", `${tag}: Tab left the dialog`);
        await page.focus("[data-gallery-viewer-close]");
        await page.keyboard.press("Shift+Tab");
        ok((await viewerSnap(page)).focus === "next", `${tag}: Shift+Tab from Close did not wrap to Next (${(await viewerSnap(page)).focus})`);
        // Esc
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
        ok((await viewerSnap(page)) === null, `${tag}: Esc did not close the viewer`);
        const back = await page.evaluate(() => ({ active: document.activeElement?.getAttribute("data-gallery-open"), overflow: getComputedStyle(document.documentElement).overflow }));
        ok(back.active === "1", `${tag}: focus did not return to the opener (${back.active})`);
        ok(back.overflow !== "hidden", `${tag}: the scroll lock stayed (${back.overflow})`);
        // backdrop press
        await page.click(opener);
        await page.waitForSelector("[data-gallery-viewer]");
        await page.mouse.click(8, h - 8);
        await page.waitForTimeout(150);
        ok((await viewerSnap(page)) === null, `${tag}: a backdrop press did not close the viewer`);
        if (shotsAt && (w === 390 || w === 1280)) {
          await page.click(opener); await page.waitForSelector("[data-gallery-viewer]"); await page.waitForTimeout(150);
          await page.screenshot({ path: join(shotsAt, `${name}-${dir}-${w}-viewer.png`) });
          await page.keyboard.press("Escape");
        }
      }
      if (shotsAt && (w === 390 || w === 1280)) await page.screenshot({ path: join(shotsAt, `${name}-${dir}-${w}.png`), fullPage: false });
      await context.close();
    }

    // ── no JavaScript (one desktop + one phone width)
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      const tag = `${name}.${dir}@${w} no-js`;
      const context = await browser.newContext({ viewport: { width: w, height: h }, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`file://${path}`);
      await page.waitForSelector("[data-gallery-item]");
      await page.waitForTimeout(100);
      const s = await page.evaluate(() => ({ buttons: document.querySelectorAll("button").length, items: document.querySelectorAll("[data-gallery-item]").length, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, viewer: !!document.querySelector("[data-gallery-viewer]"), openers: [...document.querySelectorAll("a[data-gallery-open]")].map((a) => a.getAttribute("href")) }));
      ok(s.items === spec.count && s.buttons === 0 && !s.viewer, `${tag}: static markup ${JSON.stringify(s)}`);
      ok(s.overflowX <= 0, `${tag}: overflow ${s.overflowX}`);
      if (spec.viewer) ok(s.openers.length > 0 && s.openers.every((h2) => /\.png$/.test(h2)), `${tag}: openers do not point at a picture file ${JSON.stringify(s.openers)}`);
      await context.close();
    }
  }
}

// ── motion (the grid with a viewer)
for (const m of ["reduce", "no-preference"]) {
  const path = join(dir, "pages", "viewer.ltr.html");
  writeFileSync(path, inlineCss(readFileSync(path, "utf8")));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: m });
  const page = await context.newPage();
  await page.goto(`file://${path}`);
  await page.waitForSelector("a[data-gallery-open]");
  await page.hover("a[data-gallery-open]");
  await page.waitForTimeout(450);
  const r = await page.evaluate(() => { const img = document.querySelector("[data-gallery-picture] img"); const c = getComputedStyle(img); return { transform: c.transform, duration: c.transitionDuration }; });
  if (m === "reduce") ok(r.transform === "none" && /^0s(, 0s)*$/.test(r.duration), `reduced motion: ${JSON.stringify(r)}`);
  else ok(r.transform !== "none", `motion: the hover zoom is off ${JSON.stringify(r)}`);
  await context.close();
}

await browser.close();
console.log(`${checks} checks, ${violations.length} violations`);
if (violations.length) { for (const v of violations.slice(0, 60)) console.log("✗", v); process.exit(1); }
