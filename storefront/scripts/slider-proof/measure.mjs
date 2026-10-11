// CUST-HV V8b — real-Chromium proof of the published slider (production `publishedNodes` → `resolveSlider` → `HomeSlider` markup + the compiled
// storefront stylesheet + the REAL client component mounted by scripts/slider-proof/mount.tsx). For every page (12 configurations of the
// section) in AR RTL / EN LTR at 390 / 430 / 768 / 1024 / 1280 / 1440 it checks:
//   LAYOUT      no horizontal overflow · exactly one slide active, inside the slider · every other slide inert + aria-hidden and not showing
//               (parked outside the slider, or hidden for fade / none) · the active picture loaded (the phone picture below 768 px) ·
//               copy never leaves its slide (an unbroken 100-character word wraps) · the copy sits on the chosen side (start / centre / end,
//               mirrored under RTL) · copy never collides with the arrows, dots or pause control · it is the topmost thing at its centre
//   LOGICAL RTL "previous" is on the inline-start edge and "next" on the inline-end edge · the slide that comes next waits on the inline-end
//               side · → / ← follow the visual direction · a swipe toward the inline-start edge goes forward
//   CONTROLS    arrows 44 px · dots ≥ 24 px wide · a pause button iff autoplay · aria-current on the active dot · aria-live off while it runs
//   KEYBOARD    Tab never lands inside an inactive slide · a two-tone focus ring on every control
//   NO-JS       the static markup alone shows slide 1 whole and no control
//   READABILITY with the glyphs hidden, every pixel under the heading and the sub line is read back; the WCAG ratio of the copy colour against
//               THAT pixel (alpha-composited) is ≥ 4.5 on every slide, at 3 widths; a withheld picture draws the brand surface at ≥ 4.5; the
//               button label clears 4.5 against its own fill
//   MOTION      under prefers-reduced-motion: no transition at all, no autoplay, no pause button · with motion: autoplay advances once per
//               interval, pauses on the Pause button and on hover
// Negative controls (each must make this script FAIL): --noinert (strips `inert`) · --physical (physical left / right on the arrows) ·
// --lie (forces a low-contrast copy colour) · --nomotion (strips the reduced-motion rules).
//   node scripts/pixel-proof/build-css.mjs <dir>; node scripts/slider-proof/make-pictures.mjs <dir>
//   SLIDER_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/slider-proof.render.test.tsx
//   node scripts/slider-proof/measure.mjs <dir> [--noinert|--physical|--lie|--nomotion] [--shots <outDir>]   (PIXEL_PROOF_CHROMIUM=<path>)
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

// the real client component, bundled for the browser
writeFileSync(
  join(dir, "mount.js"),
  esbuild.buildSync({
    entryPoints: [join(root, "scripts/slider-proof/mount.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": join(root, "src"), "next/link": join(root, "scripts/slider-proof/link-shim.tsx") }, define: { "process.env.NODE_ENV": '"production"' }, absWorkingDir: root,
  }).outputFiles[0].text,
);

let css = readFileSync(join(dir, "storefront.css"), "utf8");
if (flag("--physical")) css = css.replace(/inset-inline-start:\s*0\.5rem/g, "left: 0.5rem").replace(/inset-inline-end:\s*0\.5rem/g, "right: 0.5rem");
if (flag("--nomotion")) {
  const parsed = postcss.parse(css);
  parsed.walkAtRules("media", (a) => { if (/prefers-reduced-motion/.test(a.params)) a.remove(); });
  css = parsed.toString();
}
// every page links the stylesheet inline; rewrite the files once with the (possibly mutated) CSS
const inlineCss = (html) => html.replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`);

const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const VIEWPORTS = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const PIXEL_WIDTHS = new Set([390, 768, 1280]);
const ONLY = process.argv.includes("--pages") ? process.argv[process.argv.indexOf("--pages") + 1].split(",") : null;
const PAGES = ["basic", "light", "wash", "align", "fade", "none", "auto", "phone", "long", "single", "withheld", "designed"].filter((n) => !ONLY || ONLY.includes(n));
const violations = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) violations.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a]; return (lum(hi) + 0.05) / (lum(lo) + 0.05); };
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

/** In-page pixel read: worst ratio of a text colour against every pixel of a clip. */
async function pixelWorst(page, clip, fg) {
  const buf = await page.screenshot({ clip, fullPage: true });
  return page.evaluate(async ({ b64, fg }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const lf = L(fg[0], fg[1], fg[2]);
    let worst = Infinity;
    for (let p = 0; p < d.length; p += 4) {
      const lp = L(d[p], d[p + 1], d[p + 2]);
      const r = (Math.max(lf, lp) + 0.05) / (Math.min(lf, lp) + 0.05);
      if (r < worst) worst = r;
    }
    return worst;
  }, { b64: buf.toString("base64"), fg });
}

const snap = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 }; };
  const rootEl = document.querySelector("[data-slider]");
  const slides = [...document.querySelectorAll("[data-slider-slide]")].map((s, i) => {
    const cs = getComputedStyle(s);
    const h = s.querySelector("h2"), p = s.querySelector("[data-slider-copy] p"), a = s.querySelector("[data-slider-cta]"), img = s.querySelector("img");
    return {
      i, active: s.hasAttribute("data-active"), inert: s.hasAttribute("inert"), ariaHidden: s.getAttribute("aria-hidden"), rect: r(s),
      opacity: Number.parseFloat(cs.opacity), visibility: cs.visibility, surface: s.dataset.surface, bg: cs.backgroundColor, minH: Number.parseFloat(cs.minHeight), trans: cs.transitionDuration,
      h: r(h), p: r(p), a: r(a), copy: r(s.querySelector("[data-slider-copy]")),
      hColor: h ? getComputedStyle(h).color : null, pColor: p ? getComputedStyle(p).color : null,
      aBg: a ? getComputedStyle(a).backgroundColor : null, aColor: a ? getComputedStyle(a).color : null, aHeight: a ? a.getBoundingClientRect().height : null,
      img: img ? { loaded: img.complete && img.naturalWidth > 0, src: img.currentSrc } : null,
      label: s.getAttribute("aria-label"),
    };
  });
  const prev = document.querySelector('[data-slider-arrow="previous"]'), next = document.querySelector('[data-slider-arrow="next"]');
  const dots = [...document.querySelectorAll("[data-slider-dots] button")];
  const pause = document.querySelector("[data-slider-pause]");
  const bar = document.querySelector("[data-slider-bar]");
  return {
    vw: document.documentElement.clientWidth, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    root: r(rootEl), rootDir: rootEl.getAttribute("dir"), live: document.querySelector("[data-slider-track]").getAttribute("aria-live"),
    slides, prev: r(prev), next: r(next), dots: dots.map((d) => ({ ...r(d), current: d.getAttribute("aria-current") === "true", label: d.getAttribute("aria-label") })),
    pause: pause ? { ...r(pause), label: pause.getAttribute("aria-label") } : null, bar: r(bar),
    buttons: document.querySelectorAll("button").length,
    frame: document.querySelector("[data-sd]")?.getAttribute("data-sd") ?? null,
    topAtHeading: slidesTop(),
  };
  function slidesTop() {
    const s = document.querySelector("[data-slider-slide][data-active]");
    const h = s?.querySelector("h2"); if (!h) return null;
    const b = h.getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!el && (el === h || h.contains(el));
  }
});

const activeOf = (s) => s.slides.findIndex((x) => x.active);

async function load(ctx, name, d) {
  const page = await ctx.newPage();
  await page.goto(`file://${join(dir, "pages", `${name}.${d}.html`)}`);
  await page.waitForSelector("[data-slider]");
  await page.waitForTimeout(250);
  await page.evaluate(async () => { await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null)))); });
  return page;
}

async function run() {
  for (const name of PAGES) {
    for (const d of ["ltr", "rtl"]) {
      const rtl = d === "rtl";
      // fresh HTML with the (possibly mutated) stylesheet
      const file = join(dir, "pages", `${name}.${d}.html`);
      writeFileSync(file, inlineCss(readFileSync(file, "utf8")));
      for (const [w, h] of VIEWPORTS) {
        const tag = `${name}/${d}/${w}`;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "no-preference" });
        const page = await load(ctx, name, d);
        const multi = name !== "single";
        if (flag("--noinert")) await page.evaluate(() => { for (const s of document.querySelectorAll("[data-slider-slide]")) s.removeAttribute("inert"); });
        let s = await snap(page);
        const n = s.slides.length;
        const side = (x) => (rtl ? -x : x); // + = toward the inline-end edge

        // ── layout ──
        ok(s.overflowX <= 0, `${tag}: horizontal overflow ${s.overflowX}px`);
        ok(s.rootDir === d, `${tag}: slider dir ${s.rootDir}`);
        ok(s.slides.filter((x) => x.active).length === 1 && s.slides[0].active, `${tag}: exactly slide 1 is active at load`);
        const a0 = s.slides[0];
        ok(a0.rect.l >= s.root.l - 1 && a0.rect.r <= s.root.r + 1, `${tag}: active slide inside the slider`);
        ok(a0.img ? a0.img.loaded : a0.surface === "brand", `${tag}: active picture loaded`);
        for (const x of s.slides.slice(1)) {
          ok(x.inert && x.ariaHidden === "true", `${tag}: slide ${x.i + 1} inert + aria-hidden`);
          const parked = x.rect.l >= s.root.r - 1 || x.rect.r <= s.root.l + 1;
          const hidden = x.visibility === "hidden" || x.opacity === 0;
          ok(parked || hidden, `${tag}: inactive slide ${x.i + 1} is showing (rect ${Math.round(x.rect.l)}–${Math.round(x.rect.r)}, vis ${x.visibility}, op ${x.opacity})`);
        }
        ok(s.slides.every((x, i) => x.label === `${i + 1} ${rtl ? "من" : "of"} ${n}`), `${tag}: slide names (${s.slides.map((x) => x.label).join("|")})`);
        if (name === "phone") {
          const want = w < 768 ? "phone.png" : /dark2?\.png$/;
          ok(typeof want === "string" ? a0.img.src.endsWith(want) : want.test(a0.img.src), `${tag}: art direction chose ${a0.img.src.split("/").pop()}`);
        }
        if (name === "withheld") {
          ok(a0.surface === "brand" && a0.img === null, `${tag}: unproven copy withholds the picture`);
          const bg = rgb(a0.bg);
          ok(ratio(rgb(a0.hColor), bg) >= 4.5, `${tag}: brand-surface heading ratio ${ratio(rgb(a0.hColor), bg).toFixed(2)}`);
          ok(s.slides[1].surface === "picture" && s.slides[1].img?.loaded, `${tag}: a proven slide next to it still paints`);
        }
        if (name === "designed") {
          ok(/\bhgt\b/.test(s.frame ?? "") && /\bbg\b/.test(s.frame ?? ""), `${tag}: design frame tokens (${s.frame})`);
          ok(a0.minH >= 380, `${tag}: tall preset applies (${a0.minH}px)`);
        }
        // copy: inside the slide, no collisions, topmost
        for (const x of s.slides.filter((q) => q.active)) {
          if (x.h) {
            ok(x.h.l >= x.rect.l - 1 && x.h.r <= x.rect.r + 1, `${tag}: heading leaves its slide`);
            ok(x.copy.r <= x.rect.r + 1 && x.copy.l >= x.rect.l - 1, `${tag}: copy block leaves its slide`);
            ok(s.topAtHeading === true, `${tag}: heading is covered`);
          }
          if (x.a) ok(x.aHeight >= 44 - 0.5, `${tag}: slide button ${x.aHeight}px < 44`);
          const hits = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
          for (const [label, el] of [["prev", s.prev], ["next", s.next], ["bar", s.bar && { l: s.dots.length ? Math.min(...s.dots.map((q) => q.l)) : s.bar.l, r: s.dots.length ? Math.max(...s.dots.map((q) => q.r)) : s.bar.r, t: s.bar.t, b: s.bar.b }]]) {
            if (!el) continue;
            for (const part of [x.h, x.p, x.a]) ok(!hits(part, el), `${tag}: copy collides with ${label}`);
          }
        }
        if (name === "align" && w >= 768) {
          const centre = (q) => q.copy.cx - q.rect.cx;
          const slideIn = async (i) => { await page.keyboard.press("Home"); for (let k = 0; k < i; k++) await page.keyboard.press(rtl ? "ArrowLeft" : "ArrowRight"); await page.waitForTimeout(450); return snap(page); };
          await page.focus('[data-slider-arrow="next"]');
          const s0 = await slideIn(0), s1 = await slideIn(1), s2 = await slideIn(2);
          const c0 = s0.slides[0], c1 = s1.slides[1], c2 = s2.slides[2];
          ok(side(centre(c0)) < 0, `${tag}: align start sits on the inline-start side`);
          ok(Math.abs(centre(c1)) <= 8, `${tag}: align center is centred (${centre(c1).toFixed(1)})`);
          ok(side(centre(c2)) > 0, `${tag}: align end sits on the inline-end side`);
          await page.keyboard.press("Home");
          await page.waitForTimeout(450);
          s = await snap(page);
        }

        // hover on the slide button changes neither its fill nor its opacity (the proven pair is untouched)
        if (name === "basic" && w >= 1024) {
          const before = await page.evaluate(() => { const a = document.querySelector("[data-slider-slide][data-active] [data-slider-cta]"); const cs = getComputedStyle(a); return { bg: cs.backgroundColor, color: cs.color, opacity: cs.opacity }; });
          await page.hover("[data-slider-slide][data-active] [data-slider-cta]");
          await page.waitForTimeout(250);
          const after = await page.evaluate(() => { const a = document.querySelector("[data-slider-slide][data-active] [data-slider-cta]"); const cs = getComputedStyle(a); return { bg: cs.backgroundColor, color: cs.color, opacity: cs.opacity }; });
          ok(after.opacity === "1" && after.bg === before.bg && after.color === before.color, `${tag}: hover changed the proven button pair (${JSON.stringify(after)})`);
          await page.mouse.move(0, 0);
        }

        // ── no-JS ──
        {
          const nojs = await browser.newContext({ viewport: { width: w, height: h }, javaScriptEnabled: false });
          const p2 = await nojs.newPage();
          await p2.goto(`file://${file}`);
          await p2.waitForTimeout(150);
          const st = await p2.evaluate(() => {
            const root = document.querySelector("[data-slider]").getBoundingClientRect();
            const sl = [...document.querySelectorAll("[data-slider-slide]")].map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { l: b.left, r: b.right, vis: cs.visibility, op: cs.opacity, inert: e.hasAttribute("inert") }; });
            return { root: { l: root.left, r: root.right }, sl, buttons: document.querySelectorAll("button").length, h2: document.querySelector("h2")?.textContent?.length ?? 0 };
          });
          ok(st.buttons === 0, `${tag}: no-JS shows ${st.buttons} dead controls`);
          ok(st.sl[0].l >= st.root.l - 1 && st.sl[0].r <= st.root.r + 1 && st.h2 > 0, `${tag}: no-JS first slide whole`);
          for (const x of st.sl.slice(1)) ok(x.inert && (x.l >= st.root.r - 1 || x.r <= st.root.l + 1 || x.vis === "hidden" || x.op === "0"), `${tag}: no-JS other slide showing`);
          await nojs.close();
        }

        if (multi) {
          // ── controls ──
          const behaviourAuto = name === "auto";
          ok(!!s.prev && !!s.next, `${tag}: arrows present`);
          ok(s.prev.w >= 44 - 0.5 && s.prev.h >= 44 - 0.5 && s.next.w >= 44 - 0.5, `${tag}: arrows ${s.prev.w}×${s.prev.h}`);
          ok(s.prev.l >= s.root.l - 0.5 && s.next.r <= s.root.r + 0.5 && s.prev.r <= s.root.r + 0.5 && s.next.l >= s.root.l - 0.5, `${tag}: arrows inside the slider`);
          // "previous" on the inline-start edge, "next" on the inline-end edge
          ok(side(s.prev.cx - s.root.cx) < 0 && side(s.next.cx - s.root.cx) > 0, `${tag}: arrows on the wrong sides (prev ${Math.round(s.prev.cx - s.root.cx)}, next ${Math.round(s.next.cx - s.root.cx)})`);
          ok(s.dots.length === n && s.dots.every((q) => q.w >= 24 - 0.5 && q.h >= 44 - 0.5), `${tag}: dots ${s.dots.length}/${n} sizes`);
          ok(s.dots.every((q) => q.l >= s.root.l - 0.5 && q.r <= s.root.r + 0.5), `${tag}: dots leave the slider`);
          ok(s.dots[0].current && s.dots.slice(1).every((q) => !q.current), `${tag}: aria-current on dot 1`);
          ok(behaviourAuto ? !!s.pause : !s.pause, `${tag}: pause button ${s.pause ? "present" : "absent"}`);
          if (s.pause) ok(s.pause.w >= 44 - 0.5 && s.pause.h >= 44 - 0.5, `${tag}: pause ${s.pause.w}×${s.pause.h}`);
          ok(s.live === (behaviourAuto ? "off" : "polite"), `${tag}: aria-live ${s.live}`);
          // the slide that comes next waits on the inline-end side (slide mode only)
          if (!["fade", "none"].includes(name)) {
            ok(side(s.slides[1].rect.cx - s.root.cx) > 0, `${tag}: next slide waits on the wrong side`);
          }

          // ── navigation: click, keyboard, swipe ──
          const settle = name === "fade" ? 250 : name === "none" ? 60 : 450;
          if (name !== "auto") {
            await page.click('[data-slider-arrow="next"]');
            await page.waitForTimeout(settle);
            s = await snap(page);
            ok(activeOf(s) === 1, `${tag}: next → slide ${activeOf(s) + 1}`);
            ok(s.slides[1].rect.l >= s.root.l - 1 && s.slides[1].rect.r <= s.root.r + 1, `${tag}: slide 2 not in place after the transition`);
            ok(s.dots[1].current, `${tag}: dot 2 current`);
            // keyboard: the visual direction
            await page.focus('[data-slider-arrow="next"]');
            await page.keyboard.press(rtl ? "ArrowRight" : "ArrowLeft");
            await page.waitForTimeout(settle);
            ok(activeOf(await snap(page)) === 0, `${tag}: backward key`);
            await page.keyboard.press(rtl ? "ArrowLeft" : "ArrowRight");
            await page.waitForTimeout(settle);
            ok(activeOf(await snap(page)) === 1, `${tag}: forward key`);
            await page.keyboard.press("End");
            await page.waitForTimeout(settle);
            ok(activeOf(await snap(page)) === n - 1, `${tag}: End`);
            await page.keyboard.press("Home");
            await page.waitForTimeout(settle);
            ok(activeOf(await snap(page)) === 0, `${tag}: Home`);
            // swipe (touch pointer events on the viewport): toward the inline-start edge goes forward
            const swipe = (from, to) => page.evaluate(({ from, to }) => {
              const vp = document.querySelector("[data-slider-viewport]");
              const mk = (type, x) => new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: 200 });
              vp.dispatchEvent(mk("pointerdown", from)); vp.dispatchEvent(mk("pointerup", to));
            }, { from, to });
            const mid = Math.round(s.root.cx);
            await swipe(mid + 120, mid - 120); // leftwards
            await page.waitForTimeout(settle);
            ok(activeOf(await snap(page)) === (rtl ? 0 : 1) || (rtl && n > 1 && activeOf(await snap(page)) === 0), `${tag}: leftward swipe`);
            await page.keyboard.press("Home");
            await page.waitForTimeout(settle);
            await swipe(mid - 120, mid + 120); // rightwards
            await page.waitForTimeout(settle);
            const afterRight = activeOf(await snap(page));
            ok(afterRight === (rtl ? 1 : 0), `${tag}: rightward swipe → ${afterRight + 1}`);
            await page.keyboard.press("Home");
            await page.waitForTimeout(settle);
          }

          // ── keyboard traversal + focus ring ──
          await page.evaluate(() => document.activeElement?.blur?.());
          await page.evaluate(() => window.scrollTo(0, 0));
          const seen = [];
          for (let k = 0; k < 16; k++) {
            await page.keyboard.press("Tab");
            seen.push(await page.evaluate(() => {
              const e = document.activeElement; const sl = e?.closest?.("[data-slider-slide]");
              const cs = e && e !== document.body ? getComputedStyle(e) : null;
              return { inSlide: sl ? [...document.querySelectorAll("[data-slider-slide]")].indexOf(sl) : -1, active: sl ? sl.hasAttribute("data-active") : null, tag: e?.tagName, ring: cs ? { w: cs.outlineWidth, style: cs.outlineStyle, shadow: cs.boxShadow } : null, isControl: !!e?.closest?.("[data-slider-arrow],[data-slider-pause],[data-slider-dots]") };
            }));
          }
          ok(seen.every((q) => q.inSlide === -1 || q.active === true), `${tag}: Tab landed inside an inactive slide`);
          const controlStops = seen.filter((q) => q.isControl);
          ok(controlStops.length > 0 && controlStops.every((q) => q.ring.style !== "none" && Number.parseFloat(q.ring.w) >= 2 && q.ring.shadow !== "none"), `${tag}: a control lacks the two-tone focus ring`);
        }

        // ── readability on real pixels (reduced motion: nothing moves under the camera) ──
        if (PIXEL_WIDTHS.has(w)) {
          const rctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
          const rp = await load(rctx, name, d);
          if (flag("--lie")) await rp.addStyleTag({ content: "[data-slider-copy] h2,[data-slider-copy] p{color:#3d3d3d !important}" });
          const total = (await snap(rp)).slides.length;
          const indices = name === "long" ? [0, total - 1] : [...Array(total).keys()];
          for (const i of indices) {
            if (total > 1) { await rp.keyboard.press("Home"); for (let k = 0; k < i; k++) await rp.keyboard.press(rtl ? "ArrowLeft" : "ArrowRight"); }
            if (total > 1) await rp.focus(`[data-slider-dots] button:nth-child(${i + 1})`).catch(() => {});
            if (total > 1) await rp.click(`[data-slider-dots] button:nth-child(${i + 1})`);
            await rp.waitForTimeout(80);
            const sn = await snap(rp);
            const x = sn.slides[i];
            ok(x.active, `${tag}[pixels]: slide ${i + 1} not active`);
            ok(x.trans === "0s" || x.trans.split(",").every((t) => t.trim() === "0s"), `${tag}[reduced]: transition ${x.trans}`);
            if (x.surface === "picture" && x.h) {
              const hide = await rp.addStyleTag({ content: "[data-slider-copy] h2,[data-slider-copy] p{color:transparent !important}[data-slider-copy] h2 *,[data-slider-copy] p *{color:transparent !important}" });
              for (const [what, rect, col] of [["heading", x.h, x.hColor], ["sub", x.p, x.pColor]]) {
                if (!rect) continue;
                const clip = { x: Math.max(0, Math.floor(rect.l)), y: Math.max(0, Math.floor(rect.t + (await rp.evaluate(() => scrollY)))), width: Math.max(1, Math.ceil(rect.w)), height: Math.max(1, Math.ceil(rect.h)) };
                const worst = await pixelWorst(rp, clip, rgb(col));
                ok(worst >= 4.5, `${tag}[pixels] slide ${i + 1} ${what}: worst pixel contrast ${worst.toFixed(2)} < 4.5`);
              }
              await hide.evaluate((e) => e.remove());
            }
            if (x.a) {
              ok(ratio(rgb(x.aColor), rgb(x.aBg)) >= 4.5, `${tag}: slide ${i + 1} button label ${ratio(rgb(x.aColor), rgb(x.aBg)).toFixed(2)}`);
              ok(near(rgb(x.aBg)[0], rgb(x.hColor)[0], 1) && near(rgb(x.aBg)[1], rgb(x.hColor)[1], 1), `${tag}: slide ${i + 1} button fill is not the copy colour`);
            }
            if (shotsAt && ((w === 1280 || w === 390) && i < 2)) await rp.screenshot({ path: join(shotsAt, `${name}-${d}-${w}-s${i + 1}.png`), fullPage: false });
          }
          if (name === "auto" && w === 1280) {
            const fresh = await load(rctx, name, d);
            const before = await snap(fresh);
            ok(!before.pause, `${tag}[reduced]: pause button must not exist`);
            await fresh.waitForTimeout(5600);
            ok(activeOf(await snap(fresh)) === 0, `${tag}[reduced]: autoplay advanced under prefers-reduced-motion`);
          }
          await rctx.close();
        }

        // ── autoplay (motion allowed) ──
        if (name === "auto" && w === 1280) {
          const autoPage = await load(ctx, name, d);
          const first = await snap(autoPage);
          ok(!!first.pause && first.pause.label === (rtl ? "إيقاف الشرائح مؤقتاً" : "Pause slides"), `${tag}[auto]: pause label`);
          // a wrap is a cut: right after Next on the last slide no other slide is sweeping through the viewport
          await autoPage.click("[data-slider-pause]");
          await autoPage.keyboard.press("End");
          await autoPage.waitForTimeout(450);
          await autoPage.click('[data-slider-arrow="next"]');
          await autoPage.waitForTimeout(40);
          const wrapped = await snap(autoPage);
          ok(activeOf(wrapped) === 0, `${tag}[auto]: wrap landed on slide ${activeOf(wrapped) + 1}`);
          for (const x of wrapped.slides.slice(1)) ok(x.rect.l >= wrapped.root.r - 1 || x.rect.r <= wrapped.root.l + 1, `${tag}[auto]: slide ${x.i + 1} sweeps through the viewport on a wrap`);
          await autoPage.click("[data-slider-pause]"); // play again from slide 1
          await autoPage.mouse.move(0, 0);
          await autoPage.waitForTimeout(5600);
          ok(activeOf(await snap(autoPage)) === 1, `${tag}[auto]: did not advance after 5 s`);
          await autoPage.click("[data-slider-pause]");
          ok((await snap(autoPage)).pause.label === (rtl ? "تشغيل الشرائح" : "Play slides"), `${tag}[auto]: play label`);
          await autoPage.waitForTimeout(5600);
          ok(activeOf(await snap(autoPage)) === 1, `${tag}[auto]: Pause did not hold`);
          await autoPage.click("[data-slider-pause]"); // resume
          await autoPage.mouse.move(s.root.cx, s.root.cy); // hover holds it
          await autoPage.waitForTimeout(5600);
          ok(activeOf(await snap(autoPage)) === 1, `${tag}[auto]: hover did not pause`);
          await autoPage.mouse.move(0, 0);
          await autoPage.waitForTimeout(5600);
          ok(activeOf(await snap(autoPage)) === 2, `${tag}[auto]: did not resume after hover`);
        }

        if (shotsAt && (w === 1280 || w === 390) && ["basic", "withheld", "align", "designed", "phone"].includes(name)) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: join(shotsAt, `${name}-${d}-${w}.png`) });
        }
        await ctx.close();
      }
    }
  }
}

await run();
await browser.close();
const verdict = { checks, violations: violations.length };
writeFileSync(join(dir, "report.json"), JSON.stringify({ ...verdict, sample: violations.slice(0, 60) }, null, 2));
console.log(JSON.stringify(verdict));
for (const v of violations.slice(0, 40)) console.log("VIOLATION", v);
process.exit(violations.length > 0 ? 1 : 0);
