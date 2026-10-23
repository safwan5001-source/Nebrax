// AWJ-HEADER-SCRIM — evidence screenshots from the production-path proof pages (real Chromium), with a real photograph in place of
// the synthetic wide picture. `before` removes the overlay marker, which is exactly what the live store renders today (solid header).
//   node scripts/header-proof/evidence-shots.mjs <proofDir> <outDir>
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium } = req("@playwright/test");
const esbuild = createRequire(join(root, "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/"))("esbuild");
const controller = esbuild.buildSync({
  entryPoints: [join(root, "scripts/header-proof/mount-overlay.tsx")], bundle: true, write: false, format: "iife", platform: "browser",
  jsx: "automatic", alias: { "@": join(root, "src") }, define: { "process.env.NODE_ENV": '"production"' }, absWorkingDir: root,
}).outputFiles[0].text;
const dir = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PIXEL_PROOF_CHROMIUM ? { executablePath: process.env.PIXEL_PROOF_CHROMIUM } : {});
for (const [loc, w, h] of [["rtl", 390, 844], ["ltr", 1280, 800]]) {
  const src = readFileSync(join(dir, "pages", `ovStoreReplica.${loc}.html`), "utf8").replaceAll("../pic-wide.svg", "../pic-real.jpg");
  for (const variant of ["before", "after"]) {
    const html = variant === "before" ? src.replace(/ data-ho="[^"]*"/, "") : src;
    const file = join(dir, "pages", `evidence-${variant}.${loc}.html`);
    writeFileSync(file, html);
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await page.goto(`file://${file}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: `window.__PROOF=${JSON.stringify({ sticky: true, up: false })};` });
    await page.addScriptTag({ content: controller });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${variant}-${loc}-${w}-top.png`) });
    await page.evaluate(() => window.scrollTo(0, 220));
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${variant}-${loc}-${w}-scrolled.png`) });
  }
}
await browser.close();
console.log("done");
