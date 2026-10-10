// CUST-HV V6c-2 — real-Chromium proof of the published Banner CTAs: no horizontal overflow, every button inside its
// section, >= 40 px touch target, label contrast >= 4.5:1 on the painted colours, and a long label never spills out of
// its button (it ellipsises). 6 widths x AR RTL / EN LTR.
//   node scripts/pixel-proof/build-css.mjs <dir>
//   BANNER_CTA_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/banner-cta-proof.render.test.tsx
//   node scripts/banner-cta-proof/measure.mjs <dir>        (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const req = createRequire(join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "package.json"));
const { chromium } = req("@playwright/test");
const dir = resolve(process.argv[2]);
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const widths = [390, 430, 768, 1024, 1280, 1440];
const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html"));
let checks = 0; const violations = []; const rows = [];
for (const f of files) for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto("file://" + join(dir, "pages", f));
  const r = await page.evaluate(() => {
    const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const cv = document.createElement("canvas").getContext("2d");
    const norm = (c) => { cv.clearRect(0,0,1,1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0,0,1,1); const d = cv.getImageData(0,0,1,1).data; return [d[0],d[1],d[2],d[3]/255]; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const section = document.querySelector("main section");
    const sr = section.getBoundingClientRect();
    const ctas = [...section.querySelectorAll("a")].map((a) => {
      const b = a.getBoundingClientRect(); const cs = getComputedStyle(a);
      const fg = norm(cs.color); let bg = norm(cs.backgroundColor);
      if (bg[3] === 0) bg = norm(getComputedStyle(section).backgroundColor);
      const span = a.querySelector("span"); const clipped = span ? span.scrollWidth > span.clientWidth + 1 : false;
      const spills = a.scrollHeight > a.clientHeight + 1 || (span ? span.getBoundingClientRect().bottom > b.bottom + 1 : false);
      return { spills, text: a.textContent.slice(0, 12), left: b.left, right: b.right, top: b.top, bottom: b.bottom, h: b.height, ratio: ratio(fg, bg), clipped, wrapperRight: sr.right };
    });
    return { overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, sectionLeft: sr.left, sectionRight: sr.right, ctas };
  });
  rows.push({ f, w, ...r });
  checks++;
  if (r.overflowX > 0) violations.push(`${f}@${w}: horizontal overflow ${r.overflowX}`);
  r.ctas.forEach((c, i) => {
    if (c.left < r.sectionLeft - 0.5 || c.right > r.sectionRight + 0.5) violations.push(`${f}@${w}: cta ${i} outside section (${c.left.toFixed(0)}..${c.right.toFixed(0)} vs ${r.sectionLeft.toFixed(0)}..${r.sectionRight.toFixed(0)})`);
    if (c.spills) violations.push(`${f}@${w}: cta ${i} label spills out of the button`);
    if (c.h < 40) violations.push(`${f}@${w}: cta ${i} height ${c.h}`);
    if (c.ratio < 4.5) violations.push(`${f}@${w}: cta ${i} contrast ${c.ratio.toFixed(2)}`);
  });
  await page.close();
}
await browser.close();
const worst = Math.min(...rows.flatMap((r) => r.ctas.map((c) => c.ratio)));
const clipped = rows.filter((r) => r.ctas.some((c) => c.clipped)).length;
writeFileSync(join(dir, "summary.json"), JSON.stringify({ checks, violations, worstContrast: worst, rowsWithEllipsis: clipped }, null, 1));
console.log(JSON.stringify({ checks, violations: violations.length, worstContrast: +worst.toFixed(2), rowsWithEllipsis: clipped }));
violations.slice(0, 20).forEach((v) => console.log(v));
process.exit(violations.length ? 1 : 0);
