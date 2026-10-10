// CUST-HV V6c-3 — real-Chromium proof of the published hero / banner height presets and 3x3 content position:
//   * the section is at least its preset (compact 10rem, standard 18rem, tall 28rem, screen = clamp(24rem,100svh,56rem))
//     and a preset that exceeds the content is met EXACTLY (so it is the preset, not the content, that sets the height);
//   * the content is never clipped and nothing overflows horizontally;
//   * the content box sits on the chosen block-axis edge/centre and the chosen inline-axis edge/centre
//     (logical: `start` is the right edge under RTL), whenever the box is narrower than the section;
//   * an automatic position keeps today's layout once a height is set (hero centred, banner at the top).
// 6 viewports x AR RTL / EN LTR.
//   node scripts/pixel-proof/build-css.mjs <dir>
//   PLACEMENT_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/placement-proof.render.test.tsx
//   node scripts/placement-proof/measure.mjs <dir>      (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const req = createRequire(join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "package.json"));
const { chromium } = req("@playwright/test");
const dir = resolve(process.argv[2]);
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
// real device-ish viewports: [width, height]
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const REM = 16;
const PRESET_MIN = { compact: 10 * REM, standard: 18 * REM, tall: 28 * REM };
const screenMin = (vh) => Math.min(56 * REM, Math.max(24 * REM, vh));
const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html"));
const TOL = 2;
let checks = 0, placementChecks = 0, exactChecks = 0;
const violations = [];
for (const f of files) {
  const [type, height, pid, dirName] = f.replace(/\.html$/, "").split(".");
  const rtl = dirName === "rtl";
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto("file://" + join(dir, "pages", f));
    const r = await page.evaluate(() => {
      const section = document.querySelector("main section");
      const box = section.querySelector("[data-section-content]") ?? section.firstElementChild;
      const s = section.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipped: section.scrollHeight > section.clientHeight + 1 || box.scrollHeight > box.clientHeight + 1,
        s: { l: s.left, r: s.right, t: s.top, b: s.bottom, w: s.width, h: s.height },
        b: { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height },
        hasFrame: !!section.parentElement?.hasAttribute("data-sd"),
      };
    });
    checks++;
    const tag = `${f}@${w}x${h}`;
    if (r.overflowX > 0) violations.push(`${tag}: horizontal overflow ${r.overflowX}`);
    if (r.clipped) violations.push(`${tag}: content clipped`);
    const min = height === "none" ? 0 : height === "screen" ? screenMin(h) : PRESET_MIN[height];
    if (r.s.h < min - 1) violations.push(`${tag}: section ${r.s.h.toFixed(0)}px < preset ${min}px`);
    const roomy = r.s.h - r.b.h > 24; // the preset is taller than the content, so the content has room to move
    if (height !== "none" && roomy) {
      exactChecks++;
      if (Math.abs(r.s.h - min) > TOL) violations.push(`${tag}: section ${r.s.h.toFixed(1)}px is not the preset ${min}px`);
    }
    // block axis
    const valign = pid === "top-start" ? "start" : pid === "mid-center" ? "center" : pid === "bottom-end" ? "end" : null;
    const align = valign ? (pid === "top-start" ? "start" : pid === "mid-center" ? "center" : "end") : null;
    if (valign && height !== "none" && roomy) {
      placementChecks++;
      const top = r.b.t - r.s.t, bottom = r.s.b - r.b.b;
      if (valign === "start" && top > TOL) violations.push(`${tag}: not at the top (gap ${top.toFixed(1)})`);
      if (valign === "end" && bottom > TOL) violations.push(`${tag}: not at the bottom (gap ${bottom.toFixed(1)})`);
      if (valign === "center" && Math.abs(top - bottom) > TOL) violations.push(`${tag}: not centred (${top.toFixed(1)} vs ${bottom.toFixed(1)})`);
    }
    // inline axis (logical): measured from the reading-start edge
    if (align && r.b.w < r.s.w - 4) {
      placementChecks++;
      const startGap = rtl ? r.s.r - r.b.r : r.b.l - r.s.l;
      const endGap = rtl ? r.b.l - r.s.l : r.s.r - r.b.r;
      if (align === "start" && startGap > TOL) violations.push(`${tag}: not at the inline start (gap ${startGap.toFixed(1)})`);
      if (align === "end" && endGap > TOL) violations.push(`${tag}: not at the inline end (gap ${endGap.toFixed(1)})`);
      if (align === "center" && Math.abs(startGap - endGap) > TOL) violations.push(`${tag}: not centred inline (${startGap.toFixed(1)} vs ${endGap.toFixed(1)})`);
    }
    // automatic position keeps today's layout once a height is set: a hero is vertically centred, a banner sits at the top
    if (pid === "auto" && height !== "none" && roomy) {
      placementChecks++;
      const top = r.b.t - r.s.t, bottom = r.s.b - r.b.b;
      if (type === "hero" && Math.abs(top - bottom) > TOL) violations.push(`${tag}: automatic hero is not centred (${top.toFixed(1)} vs ${bottom.toFixed(1)})`);
      if (type === "banner" && top > TOL) violations.push(`${tag}: automatic banner is not at the top (gap ${top.toFixed(1)})`);
    }
    await page.close();
  }
}
await browser.close();
const summary = { pages: files.length, checks, placementChecks, presetExactChecks: exactChecks, violations };
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ pages: files.length, checks, placementChecks, presetExactChecks: exactChecks, violations: violations.length }));
violations.slice(0, 25).forEach((v) => console.log(v));
process.exit(violations.length ? 1 : 0);
