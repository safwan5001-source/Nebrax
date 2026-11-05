import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * AWJ Luxe Motion — Customizer preview ↔ published storefront parity (real browser, both apps).
 *
 * The Customizer canvas (`web/`, `/dev/luxe-motion-preview`, the real `StorefrontPreviewCanvas`) is an ILLUSTRATIVE
 * preview, not the public components: it is expected to differ in interactivity (no cart, zoom, wishlist, sort) and
 * in chrome. What must agree is the theme's design language — heading typography, gallery frame, card image ratio,
 * primary action colour — because the merchant judges the theme by that canvas. Needs, besides the storefront stack of
 * `playwright.luxe-qa.config.ts`, the web app: `cd web && npm run dev -- -p 3002` (localhost, not 127.0.0.1).
 */

const WEB = process.env.LUXE_QA_WEB_URL ?? "http://localhost:3002";
const evidenceDir = path.resolve(
  process.cwd(),
  "test-results/luxe-motion-qa/parity",
);

test.use({
  viewport: { width: 430, height: 900 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

async function metrics(page: Page, kind: "product" | "category") {
  return page.evaluate((k) => {
    const cs = (el: Element | null | undefined) =>
      el ? getComputedStyle(el) : null;
    if (k === "product") {
      const h1 = document.querySelector("h1");
      const frame = document.querySelector(
        ".overflow-hidden.rounded-store.border.border-store-border",
      );
      return {
        h1Size: cs(h1)?.fontSize,
        h1Weight: cs(h1)?.fontWeight,
        h1LineHeight: cs(h1)?.lineHeight,
        h1Family: cs(h1)?.fontFamily.split(",")[0].trim(),
        frameBorder: cs(frame)?.borderTopWidth,
        frameRadius: cs(frame)?.borderTopLeftRadius,
        frameBg: cs(frame)?.backgroundColor,
      };
    }
    const img = document.querySelector("[data-card-image]");
    const grid = img?.getBoundingClientRect();
    return {
      imageRatio: grid ? Math.round((grid.width / grid.height) * 100) / 100 : 0,
    };
  }, kind);
}

async function previewCategoryRatio(page: Page) {
  // The preview tile's image box is the first aspect-ratio element in the grid.
  return page.evaluate(() => {
    const tile = [
      ...document.querySelectorAll("[data-category-preview] *"),
    ].find((el) => /aspect-\[3\/4\]/.test(el.className?.toString() ?? ""));
    const r = tile?.getBoundingClientRect();
    return r ? Math.round((r.width / r.height) * 100) / 100 : 0;
  });
}

test("product page: heading, gallery frame agree between the Customizer preview and the storefront", async ({
  page,
}) => {
  await mkdir(evidenceDir, { recursive: true });
  await page.goto("http://localhost:3001/sa/en/products/p1", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1000);
  const published = await metrics(page, "product");
  await page.screenshot({
    path: path.join(evidenceDir, "product-published.png"),
  });

  await page.goto(
    `${WEB}/dev/luxe-motion-preview?page=product&locale=en&viewport=mobile`,
    { waitUntil: "networkidle" },
  );
  await page.waitForTimeout(1000);
  const preview = await metrics(page, "product");
  await page.screenshot({
    path: path.join(evidenceDir, "product-preview.png"),
  });

  expect(preview).toEqual(published);
  expect(Number.parseFloat(published.h1Size ?? "0")).toBeGreaterThanOrEqual(24);
});

test("category page: product-card image ratio is 3:4 in both", async ({
  page,
}) => {
  await mkdir(evidenceDir, { recursive: true });
  await page.goto("http://localhost:3001/sa/en/products", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1000);
  const published = (await metrics(page, "category")) as { imageRatio: number };
  await page.screenshot({
    path: path.join(evidenceDir, "category-published.png"),
  });

  await page.goto(
    `${WEB}/dev/luxe-motion-preview?page=category&locale=en&viewport=mobile`,
    { waitUntil: "networkidle" },
  );
  await page.waitForTimeout(1000);
  const preview = await previewCategoryRatio(page);
  await page.screenshot({
    path: path.join(evidenceDir, "category-preview.png"),
  });

  expect(published.imageRatio).toBeCloseTo(0.75, 1);
  expect(preview).toBeCloseTo(0.75, 1);
});
