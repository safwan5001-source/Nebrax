import type { Server } from "node:http";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  AdminApi,
  browsePort,
  keepThrottleClear,
  loadStack,
  rawGet,
  resetThrottle,
  type StackEnv,
  type StackStorefront,
  stackPath,
  startBrowseProxy,
  storefrontOne,
} from "./support/vd5-stack";

/**
 * AWJ-VD-H1 / VD-5 — the whole visual-dimension chain in one real browser:
 *
 *   admin API (value + image + shape) -> public `meta.facets` -> guarded origin route -> Next image proxy ->
 *   published discovery section -> the tile a shopper sees.
 *
 * 1. Journey: a value with an image and a shape, created through the admin API, renders as a link tile on the S1
 *    home page: proxied image (never the raw `/store/v1` path), the chosen shape, label, count, facet URL, and the
 *    value's name as the accessible name.
 * 2. Withdrawal: the image is withdrawn at the origin (reference removed, then the media soft-deleted). The origin
 *    route answers 404 `no-store`; the proxy answers the conditional request carrying the old ETag with a 404
 *    `no-store` (the revalidation that ends the documented 300 s cache window, so no 300 s sleep is needed); an image
 *    request that only arrives after the withdrawal falls back to the icon, keeping the shape and without a broken
 *    image; and a fresh page load renders the icon straight from the server.
 *
 * Needs a live local stack (see `playwright.vd5.config.ts`), so it is skipped unless `VD5_STACK_ENV` is set and is
 * never part of CI or of the default `playwright.config.ts` run.
 */
const STACK_PATH = stackPath();

test.describe.configure({ mode: "serial" });
test.describe("VD-5 visual dimensions: admin API -> storefront", () => {
  test.skip(
    !STACK_PATH,
    "needs a live local stack: set VD5_STACK_ENV to its env.json and run with playwright.vd5.config.ts",
  );

  const runId = Date.now().toString(36);
  const facetKey = `qa-s-e2e-${runId}`;
  const sectionId = `qa-s-e2e-disc-${runId}`;
  const names = {
    a: { ar: `قيمة اختبار ${runId} أ`, en: `QA value ${runId} A` },
    b: { ar: `قيمة اختبار ${runId} ب`, en: `QA value ${runId} B` },
  };

  let stack: StackEnv;
  let s1: StackStorefront;
  let admin: AdminApi;
  let facetId: string;
  let valueA: string;
  let valueB: string;
  let mediaA: string;
  let productId: string;
  let browseProxy: Server | undefined;
  let stopTicker: (() => void) | undefined;

  test.afterEach(() => {
    stopTicker?.();
    stopTicker = undefined;
  });

  const sectionOf = (page: Page) =>
    page.locator(`section[aria-labelledby="discovery-${sectionId}"]`);
  const tile = (section: Locator, name: string) =>
    section.getByRole("link", { name, exact: true });
  const frame = (link: Locator) =>
    link.locator("[data-facet-content] > span[aria-hidden='true']");

  const imageVisual = (
    mediaId: string,
    shape: string,
    alt: string,
    icon: string,
  ) => ({
    content: "image",
    image: { mediaId, fit: "cover", alt: { ar: alt, en: alt } },
    icon,
    iconColor: "#14532d",
    background: "#dcfce7",
    shape,
    size: "md",
    showLabel: true,
  });

  test.beforeAll(async () => {
    if (!STACK_PATH) return;
    stack = loadStack(STACK_PATH);
    s1 = storefrontOne(stack);
    admin = new AdminApi(stack);
    browseProxy = await startBrowseProxy({
      listenPort: browsePort(),
      targetPort: s1.port,
      host: s1.host,
    });

    const seed = Number.parseInt(runId, 36) % 9973;
    mediaA = await admin.uploadImage(`qa-s-e2e-a-${runId}`, seed);
    const mediaB = await admin.uploadImage(`qa-s-e2e-b-${runId}`, seed + 7);

    const facet = await admin.createFacet(
      facetKey,
      `qa-s e2e ${runId}`,
      `qa-s e2e ${runId}`,
    );
    facetId = facet.id;
    valueA = (await admin.createValue(facetId, "qa-a", names.a.ar, names.a.en))
      .id;
    valueB = (await admin.createValue(facetId, "qa-b", names.b.ar, names.b.en))
      .id;
    await admin.putValueVisual(
      facetId,
      valueA,
      imageVisual(mediaA, "hexagon", "صورة أ", "leaf"),
    );
    await admin.putValueVisual(
      facetId,
      valueB,
      imageVisual(mediaB, "circle", "صورة ب", "gift"),
    );

    productId = await admin.createProduct(`qa-s-e2e-${runId}`);
    await admin.assignValues(productId, [valueA, valueB]);
    await admin.publishProduct(productId, [s1.store_id]);

    await admin.publishDiscoverySection(s1.store_id, sectionId, {
      type: "discovery",
      visible: true,
      content: {
        title: `qa-s e2e ${runId}`,
        axis: "facet",
        dimension: facetKey,
        display: "tiles",
        layout: "image-grid",
        template: "gift-circles",
        showCounts: true,
      },
    });
  });

  test.afterAll(async () => {
    if (!STACK_PATH || !admin) return;
    browseProxy?.close();
    // Best effort: leave the stack as it was found. Every step is independent.
    const quiet = (task: Promise<unknown>) => task.catch(() => undefined);
    await quiet(admin.publishDiscoverySection(s1.store_id, sectionId, null));
    if (productId) {
      await quiet(admin.publishProduct(productId, []));
      await quiet(admin.assignValues(productId, []));
      await quiet(
        admin.call("DELETE", `/products/${productId}`, {
          ok: [200, 204, 404, 409, 422],
        }),
      );
    }
    for (const id of [valueA, valueB]) {
      if (id && facetId) {
        await quiet(
          admin.call(
            "DELETE",
            `/commerce/workspace/facets/${facetId}/values/${id}`,
            { ok: [200, 204, 404, 409, 422] },
          ),
        );
      }
    }
    if (facetId) {
      await quiet(
        admin.call("DELETE", `/commerce/workspace/facets/${facetId}`, {
          ok: [200, 204, 404, 409, 422],
        }),
      );
    }
    if (mediaA) {
      await quiet(
        admin.call("DELETE", `/commerce/workspace/storefront-media/${mediaA}`, {
          ok: [200, 204, 404, 409, 422],
        }),
      );
    }
  });

  test("journey: a value created in the admin API renders as an image tile with its shape, label, count and facet link", async ({
    page,
  }) => {
    stopTicker = keepThrottleClear();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto("/sa/ar");
    const section = sectionOf(page);
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { level: 2 })).toHaveText(
      `qa-s e2e ${runId}`,
    );

    const link = tile(section, names.a.ar);
    await expect(link).toBeVisible();
    // A real link to the existing facet filter URL.
    await expect(link).toHaveAttribute(
      "href",
      `/sa/ar/products?facet%5B${facetKey}%5D=qa-a`,
    );

    // The image goes through the same-origin proxy, never the raw origin path.
    const image = link.locator("img");
    await expect(image).toHaveCount(1);
    const src = (await image.getAttribute("src")) ?? "";
    expect(src).toMatch(
      new RegExp(
        `^/api/storefront/media/facet-visuals/[0-9a-f-]{36}/${mediaA}/(thumb-160|thumb-320|480w|768w)\\.(webp|jpg)$`,
      ),
    );
    expect(
      `${src} ${(await image.getAttribute("srcset")) ?? ""}`,
    ).not.toContain("/store/v1/");
    await expect(image).toHaveAttribute("alt", "");
    await expect(image).toHaveAttribute("loading", "lazy");
    await expect
      .poll(() =>
        image.evaluate(
          (el) =>
            (el as HTMLImageElement).complete &&
            (el as HTMLImageElement).naturalWidth,
        ),
      )
      .toBeGreaterThan(0);

    // The chosen shape is applied to the frame (hexagon = polygon clip on a square frame).
    await expect(link.locator("[data-facet-content]")).toHaveAttribute(
      "data-facet-content",
      "image",
    );
    const clip = await frame(link).evaluate(
      (el) => getComputedStyle(el).clipPath,
    );
    expect(clip.startsWith("polygon(")).toBe(true);
    const box = await frame(link).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThan(1);

    // The label is visible, and the count is spoken once through aria-describedby (the link's name stays the name).
    await expect(link).toContainText(names.a.ar);
    const describedBy = await link.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText("منتج واحد");

    // The control value renders with its own shape.
    const controlClip = await frame(tile(section, names.b.ar)).evaluate(
      (el) => getComputedStyle(el).borderRadius,
    );
    expect(controlClip).not.toBe("0px");

    // Nothing in the section leaks the origin path or an unproxied image.
    const html = await section.evaluate((el) => el.outerHTML);
    expect(html).not.toContain("/store/v1/");
    expect(errors).toEqual([]);
  });

  test("withdrawal: origin 404 no-store, conditional proxy 404 no-store, late image falls back to the icon, fresh load is server-fresh", async ({
    page,
  }) => {
    stopTicker = keepThrottleClear();
    const imagePath = (await (async () => {
      resetThrottle();
      await page.goto("/sa/ar");
      const link = tile(sectionOf(page), names.a.ar);
      await expect(link.locator("img")).toHaveCount(1);
      return (await link.locator("img").getAttribute("src")) as string;
    })()) as string;
    const [, visualId, mediaId, file] =
      imagePath.match(
        /facet-visuals\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([^/]+)$/,
      ) ?? [];
    expect(mediaId).toBe(mediaA);

    // Before the withdrawal the proxy serves the bytes with the documented shared-cache policy and an ETag.
    resetThrottle();
    const proxyHost = `${s1.host}:${s1.port}`;
    const served = await rawGet(s1.port, proxyHost, imagePath);
    expect(served.status).toBe(200);
    expect(served.headers["cache-control"]).toBe(
      "public, max-age=300, must-revalidate",
    );
    expect(served.headers["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
    const etag = served.headers.etag;
    expect(etag).toBeTruthy();

    // Hold the image request of a second page so it arrives only AFTER the withdrawal (a lazy image, a slow
    // network, a tab left open): exactly the request the 300 s window cannot protect.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = await page.context().newPage();
    await held.route(
      `**/api/storefront/media/facet-visuals/**/${mediaA}/**`,
      async (route) => {
        await gate;
        await route.continue();
      },
    );
    resetThrottle();
    await held.goto("/sa/ar", { waitUntil: "domcontentloaded" });
    const heldTile = tile(sectionOf(held), names.a.ar);
    await expect(heldTile.locator("img")).toHaveCount(1);
    // Wait until React has hydrated the tile: only then does a failing image reach its `onError` fallback.
    await expect
      .poll(() =>
        heldTile
          .locator("img")
          .evaluate((el) =>
            Object.keys(el).some((key) => key.startsWith("__react")),
          ),
      )
      .toBe(true);

    // Withdraw at the origin: the media is in use, so the admin API refuses to delete it (409) until the
    // reference is removed; then the media is soft-deleted.
    const refused = await admin.call(
      "DELETE",
      `/commerce/workspace/storefront-media/${mediaA}`,
      { ok: [409] },
    );
    expect(refused.status).toBe(409);
    await admin.putValueVisual(facetId, valueA, {
      content: "icon",
      icon: "leaf",
      iconColor: "#14532d",
      background: "#dcfce7",
      shape: "hexagon",
      size: "md",
      showLabel: true,
    });
    await admin.call(
      "DELETE",
      `/commerce/workspace/storefront-media/${mediaA}`,
    );

    // Origin: the guarded route refuses at once, uniformly, and says it must not be cached.
    resetThrottle();
    const origin = await rawGet(
      Number(new URL(stack.urls.laravel).port),
      s1.host,
      `/store/v1/media/facet-visuals/${visualId}/${mediaId}/${file}`,
      { Accept: "image/*" },
    );
    expect(origin.status).toBe(404);
    expect(origin.headers["cache-control"]).toContain("no-store");

    // Proxy: the revalidation a browser would send once its 300 s copy expires (If-None-Match with the old ETag)
    // is answered 404, not 304, and is not cacheable.
    resetThrottle();
    const revalidated = await rawGet(s1.port, proxyHost, imagePath, {
      "If-None-Match": etag as string,
    });
    expect(revalidated.status).toBe(404);
    expect(revalidated.headers["cache-control"]).toBe("no-store");
    const unconditional = await rawGet(s1.port, proxyHost, imagePath);
    expect(unconditional.status).toBe(404);
    expect(unconditional.headers["cache-control"]).toBe("no-store");

    // The late image request now reaches a 404: the tile falls back (image -> icon) and keeps its hexagon frame.
    release();
    const heldLink = heldTile;
    await expect(heldLink.locator("[data-facet-content]")).toHaveAttribute(
      "data-facet-content",
      "icon",
      { timeout: 15_000 },
    );
    await expect(heldLink.locator("img")).toHaveCount(0);
    await expect(heldLink.locator("svg").first()).toBeVisible();
    expect(
      (
        await frame(heldLink).evaluate((el) => getComputedStyle(el).clipPath)
      ).startsWith("polygon("),
    ).toBe(true);
    await expect(heldLink).toContainText(names.a.ar);
    await held.close();

    // A fresh load needs no cache window at all: the server already dropped the image from `meta.facets`.
    resetThrottle();
    await page.goto("/sa/ar");
    const section = sectionOf(page);
    const fresh = tile(section, names.a.ar);
    await expect(fresh).toBeVisible();
    await expect(fresh.locator("[data-facet-content]")).toHaveAttribute(
      "data-facet-content",
      "icon",
    );
    await expect(fresh.locator("img")).toHaveCount(0);
    expect(
      (
        await frame(fresh).evaluate((el) => getComputedStyle(el).clipPath)
      ).startsWith("polygon("),
    ).toBe(true);

    // The control value is untouched and its image still loads: the withdrawal was precise.
    const control = tile(section, names.b.ar).locator("img");
    await expect(control).toHaveCount(1);
    await expect
      .poll(() =>
        control.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    // No broken image anywhere in the section.
    const broken = await section
      .locator("img")
      .evaluateAll(
        (imgs) =>
          imgs.filter(
            (img) =>
              (img as HTMLImageElement).complete &&
              (img as HTMLImageElement).naturalWidth === 0,
          ).length,
      );
    expect(broken).toBe(0);
  });
});
