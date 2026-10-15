// Run: node scripts/mobile-menu-proof/prove.mjs before|after <absolute-output-dir>
// Real production components and stylesheet, synthetic chrome and tenant catalogue.
// No live Store API, order, checkout, database or preference writes are performed.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const { chromium, expect } = req("@playwright/test");
const esbuild = createRequire(join(root, "node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/"))("esbuild");
const phase = process.argv[2];
if (!["before", "after"].includes(phase) || !process.argv[3]) throw new Error("Use before|after <output-dir>");
const out = resolve(process.argv[3]);
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, [join(root, "scripts/pixel-proof/build-css.mjs"), out], { stdio: "inherit" });
const bundle = esbuild.buildSync({ entryPoints: [join(root, "scripts/mobile-menu-proof/mount.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", absWorkingDir: root,
  alias: { "@": join(root, "src"), "next/link": join(root, "scripts/nav-proof/link-shim.tsx"), "next/navigation": join(root, "scripts/mobile-menu-proof/shims.tsx"), "next/image": join(root, "scripts/mobile-menu-proof/shims.tsx"), "@/hooks/useCountrySwitch": join(root, "scripts/mobile-menu-proof/shims.tsx") }, define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_STORE_NAME": '"AWJ proof"' }, loader: { ".json": "json" },
}).outputFiles[0].text;
writeFileSync(join(out, "fixture.js"), bundle);
const css = readFileSync(join(out, "storefront.css"), "utf8");
const html = (params) => {
  const ar = params.get("locale") === "ar";
  const b = params.get("tenant") === "b";
  const safe = params.get("long") === "1";
  // Nonzero safe-area inset simulation tests CSS geometry; not a claim of real iOS certification.
  const paintedCSS = safe ? css.replace(/env\(safe-area-inset-(top|bottom|left|right)\)/g, (_, edge) => ({ top: "20px", bottom: "34px", left: "16px", right: "16px" })[edge]) : css;
  return `<!doctype html><html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${paintedCSS}</style></head><body><div data-published-theme="" style="--store-primary:${b ? "#6d28d9" : "#185749"};--store-surface:${b ? "#fff8ef" : "#ffffff"};--store-foreground:${b ? "#39244b" : "#1c2927"};--store-muted-foreground:#626766;--store-announcement-height:40px;--store-header-height:${safe ? "62px" : "54px"}"><div id="offer" style="position:sticky;top:0;height:40px;background:var(--store-primary);color:white;z-index:45;text-align:center">${ar ? "عروض المتجر — شحن مجاني" : "Store offers — free shipping"}</div><header style="position:sticky;top:40px;background:var(--store-surface);z-index:40;display:flex;align-items:center;justify-content:space-between;padding:8px 16px;height:${safe ? "120px" : "70px"}"><div id="mount"></div><strong>${ar ? "أَوْج" : "AWJ"} ${b ? "B" : "A"}</strong><span>◦</span></header><main style="min-height:1800px;padding:24px;background:var(--store-surface)"><h1>${ar ? "منتجات المتجر" : "Store products"}</h1><p>${ar ? "بيانات اختبار اصطناعية — المكوّن الإنتاجي" : "Synthetic catalogue — production component"}</p><button id="page-button">${ar ? "عرض المنتجات" : "Browse products"}</button></main><nav id="bottom" style="position:fixed;bottom:0;left:0;right:0;z-index:40;height:60px;border-top:1px solid #ddd;background:var(--store-surface);display:flex;justify-content:space-around;align-items:center"><span>${ar ? "الرئيسية" : "Home"}</span><span>${ar ? "الأقسام" : "Categories"}</span><span>${ar ? "حسابي" : "Account"}</span></nav></div><script>${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
};
const server = createServer((request, response) => {
  if (request.url.startsWith("/flags/")) {
    const path = join(root, "public", new URL(request.url, "http://localhost").pathname);
    response.setHeader("Content-Type", "image/svg+xml"); response.end(readFileSync(path)); return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html(new URL(request.url, "http://localhost").searchParams));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const failures = [];
const measurements = [];
let checks = 0;
const check = (condition, message) => { checks++; if (!condition) failures.push(message); };
try {
  const widths = phase === "before" ? [390, 768] : [320, 390, 430, 768, 1023];
  for (const tenant of phase === "before" ? ["a"] : ["a", "b"]) for (const locale of ["ar", "en"]) for (const width of widths) for (const long of phase === "before" ? [false] : [false, true]) {
    const tag = `${tenant}-${locale}-${width}-${long ? "long-safe" : "short"}`;
    console.log(`${phase}: ${tag}`);
    const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 844 }, reducedMotion: long ? "reduce" : "no-preference" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(tag, error.message); });
    await page.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/?locale=${locale}&tenant=${tenant}&long=${long ? 1 : 0}`);
    const trigger = page.locator("#mount button").first();
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(400);
    const metrics = await dialog.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const close = element.querySelector(`button[aria-label="${document.documentElement.lang === "ar" ? "إغلاق القائمة" : "Close menu"}"]`);
      const footer = element.querySelector('[data-slot="sheet-footer"]');
      const nav = element.querySelector("nav");
      const row = nav?.querySelector("a");
      const visible = (node) => !!node && !!node.getClientRects().length;
      const cs = getComputedStyle(element);
      const items = [...nav.querySelectorAll(':scope > a, :scope > button')];
      return { x: r.x, y: r.y, w: r.width, h: r.height, side: element.dataset.side, direction: cs.direction, closeVisible: visible(close), align: row && getComputedStyle(row).textAlign, rowHeights: items.map((item) => item.getBoundingClientRect().height), footerBottom: footer?.getBoundingClientRect().bottom, footerPadding: footer && getComputedStyle(footer).paddingBottom, paddingTop: cs.paddingTop, navClient: nav.clientHeight, navScroll: nav.scrollHeight, bodyLocked: getComputedStyle(document.body).overflow === "hidden", background: cs.backgroundColor, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, overlayBG: getComputedStyle(document.querySelector('[data-slot="sheet-overlay"]')).backgroundColor };
    });
    measurements.push({ tag, ...metrics });
    if (!long && [390, 768].includes(width)) {
      await page.mouse.move(locale === "ar" ? 8 : width - 8, 400);
      await page.screenshot({ path: join(out, `${tag}.png`) });
    }
    if (phase === "after") {
      const rtl = locale === "ar";
      check(!errors.length, `${tag}: JS errors ${errors}`);
      check(metrics.side === (rtl ? "right" : "left") && metrics.direction === (rtl ? "rtl" : "ltr"), `${tag}: direction/side`);
      check(Math.abs(metrics.y) < 1 && Math.abs(metrics.h - (width === 768 ? 1024 : 844)) < 1, `${tag}: viewport-height independent of header`);
      check(rtl ? Math.abs(metrics.x + metrics.w - width) < 1 : Math.abs(metrics.x) < 1, `${tag}: start edge`);
      check(metrics.w <= Math.min(384, width - 48) + 1, `${tag}: reachable outside area`);
      check(metrics.align === "start", `${tag}: logical text alignment`);
      check(metrics.rowHeights.every((h) => h >= 44), `${tag}: compressed navigation rows ${metrics.rowHeights}`);
      check(metrics.closeVisible, `${tag}: no close control`);
      check(!metrics.horizontalOverflow, `${tag}: horizontal overflow`);
      check(metrics.bodyLocked, `${tag}: page scroll not locked`);
      check(metrics.overlayBG !== "rgba(0, 0, 0, 0)", `${tag}: transparent backdrop`);
      check(metrics.footerBottom <= metrics.h + 1, `${tag}: footer out of viewport`);
      check(long ? metrics.footerPadding === "50px" && metrics.paddingTop === "20px" : metrics.footerPadding === "16px", `${tag}: safe-area padding`);
      check(metrics.background === (tenant === "b" ? "rgb(255, 248, 239)" : "rgb(255, 255, 255)"), `${tag}: tenant theme`);
      const content = await dialog.textContent();
      check(content.includes(tenant === "a" ? "SAR" : "USD") && !content.includes(tenant === "a" ? "USD" : "SAR"), `${tag}: tenant currency isolation`);
      check((await dialog.locator('[data-mobile-extra-nav]').first().getAttribute("href")).endsWith(`about-${tenant}`), `${tag}: tenant href isolation`);
      check(await dialog.getByRole("link", { name: "External" }).count() === 0, `${tag}: hidden accordion child exposed`);
      const dropdown = dialog.locator("[data-mobile-nav-group] button");
      await dropdown.click();
      check(await dialog.getByRole("link", { name: "External" }).getAttribute("rel") === "noopener noreferrer", `${tag}: external rel preserved`);
      await dropdown.click();
      if (long) {
        check(metrics.navScroll > metrics.navClient, `${tag}: catalogue not independently scrollable`);
        await dialog.locator("nav").first().evaluate((nav) => nav.scrollTop = nav.scrollHeight);
        check(await dialog.locator("nav").first().evaluate((nav) => nav.scrollTop > 0), `${tag}: cannot scroll nav`);
        await dialog.locator("nav").first().evaluate((nav) => nav.scrollTop = 0);
      }
      if (long && width === 390) {
        await page.setViewportSize({ width: 844, height: 390 });
        const rotated = await dialog.evaluate((node) => ({ h: node.getBoundingClientRect().height, footer: node.querySelector('[data-slot="sheet-footer"]').getBoundingClientRect().bottom }));
        check(Math.abs(rotated.h - 390) < 1 && rotated.footer <= 391, `${tag}: landscape viewport/footer`);
        await page.setViewportSize({ width, height: 844 });
        await dialog.getByRole("button", { name: locale === "ar" ? "إغلاق القائمة" : "Close menu", exact: true }).focus();
        for (let tab = 0; tab < 8; tab++) await page.keyboard.press("Tab");
        check(await dialog.evaluate((node) => node.contains(document.activeElement)), `${tag}: focus escaped modal`);
        await dialog.locator("nav").first().evaluate((nav) => nav.scrollTop = 0);
      }
      // Traverse two category levels, then dismiss and reopen: no stale stack or hidden-panel focus.
      await dialog.locator("nav > button").first().click();
      await page.waitForTimeout(350);
      check(await dialog.locator('[data-mobile-menu-panel="main"]').evaluate((node) => node.inert), `${tag}: inactive panel focusable`);
      await dialog.locator('nav:not([inert]) > button').last().click();
      await page.waitForTimeout(350);
      check(await dialog.getByRole("link", { name: locale === "ar" ? "منتجات المجموعة" : "Collection products" }).isVisible(), `${tag}: nested category unreachable`);
      await dialog.locator(':scope > div').first().getByRole("button").first().click();
      check(await dialog.locator('[data-mobile-menu-panel="category"]').first().evaluate((node) => !node.inert && node.classList.contains("translate-x-0")), `${tag}: Back leaves parent offscreen`);
      await page.waitForTimeout(350);
      await dialog.locator(':scope > div').first().getByRole("button").first().click();
      check(await dialog.locator('[data-mobile-menu-panel="main"]').evaluate((node) => !node.inert && node.classList.contains("translate-x-0")), `${tag}: Back to main failed`);
      await page.waitForTimeout(350);
      // Nested region dialog must dismiss independently without submitting preferences.
      await dialog.locator('[data-slot="sheet-footer"] button').click();
      await expect(page.locator('[role="dialog"]')).toHaveCount(2);
      await page.waitForTimeout(350);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(1);
      check(await dialog.isVisible(), `${tag}: region Escape also closed menu`);
      await dialog.getByRole("button", { name: locale === "ar" ? "إغلاق القائمة" : "Close menu", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      check(await page.getByRole("dialog").count() === 0, `${tag}: close button failed`);
      check(await trigger.evaluate((node) => document.activeElement === node), `${tag}: trigger focus not restored`);
      await trigger.click(); await dialog.waitFor(); await page.waitForTimeout(400);
      check(await dialog.locator('[data-mobile-menu-panel="main"]').evaluate((node) => !node.inert), `${tag}: reopen retained stack`);
      // Outside click and Escape must both close; page chrome cannot be hit through the modal.
      const outsideX = rtl ? 8 : width - 8;
      check(await page.evaluate(({ x }) => document.elementFromPoint(x, 20)?.getAttribute("data-slot") === "sheet-overlay", { x: outsideX }), `${tag}: announcement paints above overlay`);
      check(await page.evaluate(({ x }) => document.elementFromPoint(x, innerHeight - 20)?.getAttribute("data-slot") === "sheet-overlay", { x: outsideX }), `${tag}: bottom nav paints above overlay`);
      await page.mouse.click(outsideX, 200); await expect(page.getByRole("dialog")).toHaveCount(0);
      check(await page.getByRole("dialog").count() === 0, `${tag}: outside click failed`);
      await trigger.click(); await dialog.waitFor(); await page.waitForTimeout(400); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
      check(await page.getByRole("dialog").count() === 0, `${tag}: Escape failed`);
      check(await page.evaluate(() => getComputedStyle(document.body).overflow !== "hidden"), `${tag}: scroll lock leaked after close`);
    }
    await context.close();
  }
} catch (error) {
  failures.push(`Browser proof interrupted: ${error.message}`);
  console.error(error);
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
writeFileSync(join(out, "results.json"), JSON.stringify({ phase, checks, cases: measurements.length, failures, measurements }, null, 2) + "\n");
console.log(JSON.stringify({ phase, cases: measurements.length, checks, failures }, null, 2));
if (failures.length) process.exitCode = 1;
