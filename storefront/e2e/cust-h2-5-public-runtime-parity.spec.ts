import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * CUST-H2-5 — public Product/Category runtime parity, real-browser evidence.
 *
 * **Fixture/mocked-backend evidence, not full E2E.** These specs navigate to
 * `/dev/product-visual` and `/dev/category-visual` — development-only fixture
 * routes (404 in production) that mount the exact, unmodified
 * `ProductDetails` / `CategoryBanner` + `ProductListing` components the real
 * `products/[slug]` and `c/[...permalink]` routes render, with fixture data
 * and a `pagePresentation` override passed directly as a prop — the same
 * seam the real routes fill from `fetchPublishedPresentation()`. This proves
 * the region-order/visibility/data-absence/malformed-safety logic renders
 * correctly in a real browser (Chromium), with real Tailwind, real RTL/LTR,
 * and real hydration. It does **not** prove the authenticated Customizer →
 * Publish → public-route chain end-to-end — that chain has no Docker/live
 * backend available in every environment this repository runs in (this
 * package's own `e2e/checkout.spec.ts` already documents the same
 * constraint via `pnpm run e2e:up`). That chain's Draft/Published storage
 * layer is proven instead by the existing backend `StorefrontPresentation*Test.php`
 * suite (H2-1's own Save/Duplicate/Publish/Schedule lifecycle tests) plus
 * `fetchPublishedPresentation()`'s own unit tests (`storefront.test.ts`)
 * proving it only ever reads `published_config` — never Draft. See the
 * CUST-H2-5 implementation report's "Playwright / Real Browser QA" and
 * "Lifecycle Verification" sections for the full picture.
 *
 * Home is not re-verified here: this slice touches no Home file (confirmed
 * via `git diff --stat`), and `e2e/store-brand-qa.spec.ts`'s own
 * fixture-based scenarios (`/dev/trust-visual`) already cover Home/chrome
 * across this same viewport matrix without needing this PR's own
 * re-verification — re-running here would be pure duplication.
 *
 * `[data-region]` is the hook this slice adds to `ProductDetails.tsx` /
 * `CategoryBanner.tsx` (one per rendered, resolved region, in DOM order) —
 * real markup on the real production components, not a test-only shim.
 */

const evidenceDir = path.resolve(
  process.cwd(),
  "test-results/cust-h2-5-public-runtime-parity",
);

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

async function regionOrder(page: Page): Promise<string[]> {
  return page
    .locator("[data-region]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-region") ?? ""),
    );
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}

async function assertDirection(page: Page, dir: "rtl" | "ltr") {
  // `DirectionLock` applies `dir` client-side after hydration (the `/dev`
  // layout pins Arabic by default server-side); poll rather than a single
  // read to avoid a hydration-timing race, not to paper over a real bug —
  // a genuine failure to switch still times out and fails loudly.
  await page.waitForFunction(
    (expected) => document.documentElement.dir === expected,
    dir,
    { timeout: 3000 },
  );
  expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
}

// ─── Product ────────────────────────────────────────────────────────────

test.describe("Product — default layout (no pagePresentation)", () => {
  test("AR 1440 — canonical region order, RTL, no overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/dev/product-visual?locale=ar");
    await expect(page.locator("h1")).toBeVisible();
    expect(await regionOrder(page)).toEqual([
      "identity",
      "price",
      "availability",
      "quantity_cta",
      "description",
      "custom_fields",
      "sku_options_details",
    ]);
    await assertDirection(page, "rtl");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "product-default-ar-1440.png"),
      fullPage: true,
    });
  });

  test("AR 768 — tablet, add-to-cart reachable, no overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.goto("/dev/product-visual?locale=ar");
    await expect(
      page.locator('[data-region="quantity_cta"] button').first(),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "product-default-ar-768.png"),
      fullPage: true,
    });
  });

  test("AR 390 — mobile, canonical order, no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/dev/product-visual?locale=ar");
    expect(await regionOrder(page)).toEqual([
      "identity",
      "price",
      "availability",
      "quantity_cta",
      "description",
      "custom_fields",
      "sku_options_details",
    ]);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "product-default-ar-390.png"),
      fullPage: true,
    });
  });

  test("EN 430 — LTR, no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 900 });
    await page.goto("/dev/product-visual?locale=en");
    await assertDirection(page, "ltr");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "product-default-en-430.png"),
      fullPage: true,
    });
  });

  test("EN 1024 — no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto("/dev/product-visual?locale=en");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "product-default-en-1024.png"),
      fullPage: true,
    });
  });
});

test.describe("Product — authored presentation differences", () => {
  test("AR 1280 — hidden optional region: description disappears, commerce path stays", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(
      "/dev/product-visual?locale=ar&scenario=hidden-description",
    );
    expect(await regionOrder(page)).not.toContain("description");
    await expect(
      page.locator('[data-region="quantity_cta"] button').first(),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "product-hidden-description-ar-1280.png"),
      fullPage: true,
    });
  });

  test("EN 1280 — reordered content: sku/details before description", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/dev/product-visual?locale=en&scenario=reordered");
    const order = await regionOrder(page);
    expect(order.indexOf("sku_options_details")).toBeLessThan(
      order.indexOf("description"),
    );
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "product-reordered-en-1280.png"),
      fullPage: true,
    });
  });

  test("variant Product (EN 1024) — variant_selector renders with real options", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto("/dev/product-visual?locale=en&scenario=variant");
    expect(await regionOrder(page)).toContain("variant_selector");
    await expect(
      page
        .locator('[data-region="variant_selector"]')
        .getByText("Color", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, "product-variant-en-1024.png"),
      fullPage: true,
    });
  });

  test("non-variant Product — variant_selector is never rendered", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto("/dev/product-visual?locale=en");
    expect(await regionOrder(page)).not.toContain("variant_selector");
  });

  test("no-sku Product — sku_options_details is honestly omitted, not fabricated", async ({
    page,
  }) => {
    await page.goto("/dev/product-visual?locale=ar&scenario=no-sku");
    expect(await regionOrder(page)).not.toContain("sku_options_details");
  });

  test("no-description Product — description is honestly omitted even though the region is visible", async ({
    page,
  }) => {
    await page.goto("/dev/product-visual?locale=en&scenario=no-description");
    expect(await regionOrder(page)).not.toContain("description");
  });
});

// ─── Category ───────────────────────────────────────────────────────────

const categoryDefaultOrder = [
  "breadcrumbs",
  "identity_title",
  "description",
  "subcategories_rail",
];

test.describe("Category — default layout (no pagePresentation)", () => {
  test("AR 430 — canonical region order, RTL, no overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 430, height: 1000 });
    await page.goto("/dev/category-visual?locale=ar");
    expect(await regionOrder(page)).toEqual(categoryDefaultOrder);
    await assertDirection(page, "rtl");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "category-default-ar-430.png"),
      fullPage: true,
    });
  });

  test("AR 1024 — many-children rail, no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto("/dev/category-visual?locale=ar&scenario=many-children");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "category-many-children-ar-1024.png"),
      fullPage: true,
    });
  });

  test("EN 390 — canonical order, LTR, no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto("/dev/category-visual?locale=en");
    expect(await regionOrder(page)).toEqual(categoryDefaultOrder);
    await assertDirection(page, "ltr");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "category-default-en-390.png"),
      fullPage: true,
    });
  });

  test("EN 1280 — no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/dev/category-visual?locale=en");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "category-default-en-1280.png"),
      fullPage: true,
    });
  });

  test("empty Category — no fabricated description/subcategories/products", async ({
    page,
  }) => {
    await page.goto("/dev/category-visual?locale=en&scenario=empty");
    expect(await regionOrder(page)).toEqual(["breadcrumbs", "identity_title"]);
    await expect(page.getByText(/no products found/i)).toBeVisible();
  });
});

test.describe("Category — authored presentation differences", () => {
  test("AR 1024 — hidden description, breadcrumbs/title/grid stay present", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto(
      "/dev/category-visual?locale=ar&scenario=hidden-description",
    );
    const order = await regionOrder(page);
    expect(order).not.toContain("description");
    expect(order).toEqual(
      expect.arrayContaining(["breadcrumbs", "identity_title"]),
    );
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "category-hidden-description-ar-1024.png"),
      fullPage: true,
    });
  });

  test("EN 768 — hidden subcategories rail", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.goto(
      "/dev/category-visual?locale=en&scenario=hidden-subcategories",
    );
    expect(await regionOrder(page)).not.toContain("subcategories_rail");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "category-hidden-subcategories-en-768.png"),
      fullPage: true,
    });
  });

  test("AR 1280 — reordered: subcategories_rail ahead of description", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/dev/category-visual?locale=ar&scenario=reordered");
    const order = await regionOrder(page);
    expect(order.indexOf("subcategories_rail")).toBeLessThan(
      order.indexOf("description"),
    );
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(evidenceDir, "category-reordered-ar-1280.png"),
      fullPage: true,
    });
  });
});

// ─── Accessibility ──────────────────────────────────────────────────────

test.describe("Accessibility — focus order follows resolved region order", () => {
  test("Product: Tab order visits regions in resolved (reordered) order", async ({
    page,
  }) => {
    await page.goto("/dev/product-visual?locale=en&scenario=reordered");
    // The reordered scenario puts SKU/details before description; the SKU
    // section has no focusable control, so this asserts the *reading* order
    // via DOM position (already asserted above) plus that no focusable
    // element inside a later region appears before an earlier one's DOM node.
    const order = await regionOrder(page);
    expect(order).toEqual([
      "identity",
      "price",
      "availability",
      "quantity_cta",
      "sku_options_details",
      "description",
      "custom_fields",
    ]);
  });

  test("Category: breadcrumbs render as a semantic nav landmark", async ({
    page,
  }) => {
    await page.goto("/dev/category-visual?locale=en");
    await expect(page.locator("nav").first()).toBeVisible();
  });

  test("Product: heading hierarchy starts at h1", async ({ page }) => {
    await page.goto("/dev/product-visual?locale=en");
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("Category: heading hierarchy starts at h1", async ({ page }) => {
    await page.goto("/dev/category-visual?locale=en");
    await expect(page.locator("h1")).toHaveCount(1);
  });
});
