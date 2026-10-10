// CUST-HV V6c-6 — real-Chromium proof of per-CTA `colour` x `style` on the published hero and banner:
//   * every button is painted EXACTLY with the paint the renderer should produce (role colour -> fill / label / border),
//     also under the global button tokens (which must not recolour a coloured button);
//   * solid / soft: the label clears 4.5:1 over the button's own opaque fill (by construction);
//   * outline / link: SOUNDNESS of the publish gate against the real pixels — the button's text and border are hidden,
//     the pixels that really sit behind the button are sampled, and whenever the gate PASSED the colour its worst measured
//     contrast against those pixels is >= 4.5 (the gate is conservative: it may reject a colour that happens to fit);
//     the gate's rejections are counted, not asserted;
//   * tap heights (hero 36px / 44px from md, banner 40px) and no overflow / overlap / sticking out.
// default surface, solid design background and proven picture background x 6 viewports x AR RTL / EN LTR.
// `--blind` makes the gate pass everything (negative control: unsound pages must then be found).
//   node scripts/pixel-proof/build-css.mjs <dir>
//   CTA_COLOUR_PROOF_DIR=<dir> npx vitest run src/components/home/__tests__/cta-colour-proof.render.test.tsx
//   node scripts/cta-colour-proof/measure.mjs <dir> [--blind]    (PIXEL_PROOF_CHROMIUM=<path> selects a Chromium binary)
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const req = createRequire(join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "package.json"));
const { chromium } = req("@playwright/test");
const dir = resolve(process.argv[2]);
const blind = process.argv.includes("--blind");
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
const viewports = [[390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const files = readdirSync(join(dir, "pages")).filter((f) => f.endsWith(".html")).sort();
const violations = [];
let checks = 0, buttons = 0, paintChecks = 0, pixelChecks = 0, gatePass = 0, gateReject = 0;
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const expectColour = (v) => (v === "transparent" ? "rgba(0, 0, 0, 0)" : hexToRgb(v));

// Decode a PNG in the page (Chromium) and return the worst contrast between `label` and every sampled pixel.
const worstAgainstPixels = (page, dataUrl, labelHex) =>
  page.evaluate(async ({ dataUrl, labelHex }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const n = parseInt(labelHex.slice(1), 16);
    const L = lum((n >> 16) & 255, (n >> 8) & 255, n & 255);
    let worst = Infinity;
    for (let i = 0; i < data.length; i += 16) { // every 4th pixel
      const P = lum(data[i], data[i + 1], data[i + 2]);
      const [hi, lo] = L > P ? [L, P] : [P, L];
      worst = Math.min(worst, (hi + 0.05) / (lo + 0.05));
    }
    return worst;
  }, { dataUrl, labelHex });

for (const f of files) {
  const name = f.replace(/\.html$/, "");
  const [type, kind, style, colour, dirName, gt] = name.split(".");
  const sidecar = JSON.parse(readFileSync(join(dir, "pages", `${name}.json`), "utf8"));
  const gateRejected = !blind && sidecar.gate.length > 0;
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto("file://" + join(dir, "pages", f));
    await page.waitForLoadState("load");
    const r = await page.evaluate(() => {
      const section = document.querySelector("main section");
      const s = section.getBoundingClientRect();
      const out = [...section.querySelectorAll("a[data-cta-style]")].map((a, i) => {
        const cs = getComputedStyle(a), rect = a.getBoundingClientRect();
        a.setAttribute("data-i", String(i));
        return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, bw: cs.borderTopWidth, deco: cs.textDecorationLine,
          colour: a.getAttribute("data-cta-colour"), h: rect.height, rect: { l: rect.left, r: rect.right, t: rect.top, b: rect.bottom } };
      });
      return { overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, section: { l: s.left, r: s.right }, buttons: out };
    });
    checks++;
    const tag = `${f}@${w}x${h}`;
    if (r.overflowX > 0) violations.push(`${tag}: horizontal overflow ${r.overflowX}`);
    if (r.buttons.length !== 2) { violations.push(`${tag}: expected 2 buttons, found ${r.buttons.length}`); await page.close(); continue; }
    const minTap = type === "banner" ? 40 : w >= 768 ? 44 : 36;
    for (let i = 0; i < 2; i++) {
      const b = r.buttons[i], want = sidecar.paint[i];
      buttons++; paintChecks++;
      if (b.colour !== colour) violations.push(`${tag}: button ${i} has no data-cta-colour=${colour}`);
      const fill = expectColour(want.fill), label = expectColour(want.label), border = expectColour(want.border);
      if (b.bg !== fill) violations.push(`${tag}: button ${i} fill ${b.bg} != ${fill}`);
      if (b.color !== label) violations.push(`${tag}: button ${i} label ${b.color} != ${label}`);
      if (b.border !== border) violations.push(`${tag}: button ${i} border ${b.border} != ${border}`);
      if (b.h < minTap - 0.5) violations.push(`${tag}: button ${i} is ${b.h.toFixed(1)}px < ${minTap}px`);
      if (b.rect.l < r.section.l - 1 || b.rect.r > r.section.r + 1) violations.push(`${tag}: button ${i} sticks out of the section`);
      if (style === "link" && !b.deco.includes("underline")) violations.push(`${tag}: link button ${i} has no underline`);
      if (style === "outline" && parseFloat(b.bw) < 2) violations.push(`${tag}: outline button ${i} border ${b.bw}`);
    }
    {
      const [a, b] = r.buttons;
      const ox = Math.min(a.rect.r, b.rect.r) - Math.max(a.rect.l, b.rect.l), oy = Math.min(a.rect.b, b.rect.b) - Math.max(a.rect.t, b.rect.t);
      if (ox > 0.5 && oy > 0.5) violations.push(`${tag}: the two buttons overlap`);
    }
    // by construction: label over the button's own opaque fill
    if (style === "solid" || style === "soft") {
      for (let i = 0; i < 2; i++) {
        const want = sidecar.paint[i];
        const ratio = await worstAgainstPixels(page, "data:image/png;base64," + (await page.screenshot({ clip: { x: r.buttons[i].rect.l + 8, y: (r.buttons[i].rect.t + r.buttons[i].rect.b) / 2 - 3, width: 4, height: 6 }, type: "png" })).toString("base64"), want.label);
        pixelChecks++;
        if (ratio < 4.5 - 0.05) violations.push(`${tag}: ${style} button ${i} label ${ratio.toFixed(2)}:1 over its own fill`);
      }
    }
    // soundness of the gate against the pixels really behind an outline / link button
    if (style === "outline" || style === "link") {
      if (gateRejected) { if (w === 1280 && dirName === "ltr") gateReject++; }
      else {
        if (w === 1280 && dirName === "ltr") gatePass++;
        for (let i = 0; i < 2; i++) {
          const el = page.locator(`a[data-i="${i}"]`);
          // hide the label and the border so only what is BEHIND the button is photographed
          await el.evaluate((n) => { n.style.setProperty("color", "transparent", "important"); n.style.setProperty("border-color", "transparent", "important"); n.style.setProperty("text-decoration-color", "transparent", "important"); });
          const box = await el.boundingBox();
          const png = await page.screenshot({ clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height }, type: "png" });
          const ratio = await worstAgainstPixels(page, "data:image/png;base64," + png.toString("base64"), sidecar.paint[i].label);
          pixelChecks++;
          // 0.1 slack: gradient sampling / 8-bit rounding of the photographed pixels
          if (ratio < 4.5 - 0.1) violations.push(`${tag}: the gate passed ${colour} ${style} but the pixels behind button ${i} give ${ratio.toFixed(2)}:1`);
        }
      }
    }
    await page.close();
  }
}
await browser.close();
const summary = { pages: files.length, checks, buttons, paintChecks, pixelChecks, gatePassedColourPages: gatePass, gateRejectedColourPages: gateReject, blind, violations: violations.length, sample: violations.slice(0, 10) };
if (!blind) writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, violations }, null, 1));
console.log(JSON.stringify(summary));
violations.slice(0, 25).forEach((v) => console.log(v));
process.exit(violations.length ? 1 : 0);
