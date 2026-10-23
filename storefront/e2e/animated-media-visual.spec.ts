import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * AWJ-ANIMATED-MEDIA P1 — the animated-media rendering in a REAL browser (Chromium), against the real
 * `SectionBackdrop` / `HomeSlider` on `/dev/animated-media-visual`.
 *
 * The fixtures are the bytes the PHP pipeline actually produces (`StorefrontAnimatedImage::sanitize()` /
 * `posterBytes()`), so this proves a browser decodes and animates the SANITISED files, not just the originals.
 * Every request to the same-origin media proxy path is answered here and logged, so "the animation was never
 * even fetched" is assertable (reduced motion, no JavaScript, paused).
 *
 * Needs no backend. `pnpm exec playwright test -c playwright.animated-media.config.ts`
 * Not covered here (no WebKit/Firefox in this environment): Safari/iOS — see the report's manual checklist.
 */
const FX = join(__dirname, "support", "animated-fixtures");
const bytes = (name: string) => readFileSync(join(FX, name));

async function serveMedia(target: Page | BrowserContext, log: string[]) {
  await target.route("**/api/storefront/media/customizer/**", (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    log.push(file);
    const reply = (name: string, type: string) =>
      route.fulfill({
        status: 200,
        body: bytes(name),
        contentType: type,
        headers: { "cache-control": "no-store" },
      });
    if (file === "control.gif")
      return reply("control-original.gif", "image/gif");
    if (file === "animated.gif") return reply("animated.gif", "image/gif");
    if (file === "animated.webp") return reply("animated.webp", "image/webp");
    if (file === "first-frame.webp")
      return reply("webp-first-frame.webp", "image/webp");
    if (file.endsWith(".webp")) return reply("still.webp", "image/webp");
    if (file.endsWith(".jpg")) return reply("still.jpg", "image/jpeg");
    return route.fulfill({ status: 404 });
  });
}

const HERO = "[data-sd-backdrop] img";
const SLIDE = "[data-slider-slide] img";
const TOGGLE = "[data-motion-toggle]";

const currentSrc = (page: Page, sel: string) =>
  page.evaluate(
    (s) =>
      (document.querySelector(s) as HTMLImageElement | null)?.currentSrc ?? "",
    sel,
  );

/** The dominant channel (r/g/b) of the image's current frame, sampled over time. */
async function frames(page: Page, sel: string, count = 14, gap = 90) {
  return page.evaluate(
    async ({ sel, count, gap }) => {
      const img = document.querySelector(sel) as HTMLImageElement;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        out.push(
          r > g && r > b
            ? "r"
            : b > r && b > g
              ? "b"
              : g > r && g > b
                ? "g"
                : "?",
        );
        await new Promise((resolve) => setTimeout(resolve, gap));
      }
      return out;
    },
    { sel, count, gap },
  );
}

/**
 * Canary: does THIS browser advance animated images at all? Samples an UNTOUCHED, known-good control GIF
 * (solid red → blue → lime, 200 ms). Some headless/CI Chromium builds paint the first frame forever; asserting
 * motion there would test the browser, not the product. The playback tests skip (visibly) when it fails.
 */
async function browserAnimates(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const img = new Image();
    img.src = "/api/storefront/media/customizer/x/control.gif";
    document.body.appendChild(img);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const seen = new Set<string>();
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      seen.add(`${r},${g},${b}`);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    img.remove();
    return seen.size > 1;
  });
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Only real faults: a hydration mismatch (the gated sources must not cause one) or an uncaught error.
    // (next-intl's dev-only `timeZone` notice is a known warning on every /dev page.)
    if (/hydrat|did not match|mismatch/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const open = (page: Page, scenario: string, locale = "en") =>
  page.goto(`/dev/animated-media-visual?scenario=${scenario}&locale=${locale}`);

test.describe("animated media — real Chromium", () => {
  test("GIF hero: still first, then the animated source after hydration; no hydration errors", async ({
    page,
  }) => {
    const log: string[] = [];
    const errors = watchErrors(page);
    await serveMedia(page, log);
    await open(page, "desktop-gif");

    await page.waitForSelector(TOGGLE);
    await expect.poll(() => currentSrc(page, HERO)).toMatch(/animated\.gif$/);
    expect(log).toContain("animated.gif");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("GIF playback: frames really change (skipped where the browser cannot animate a control GIF)", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "desktop-gif");
    await page.waitForSelector(TOGGLE);
    await expect.poll(() => currentSrc(page, HERO)).toMatch(/animated\.gif$/);
    test.skip(
      !(await browserAnimates(page)),
      "this Chromium build does not advance animated images (control GIF stayed on frame 0)",
    );
    const seen = new Set(await frames(page, HERO));
    expect(seen.has("r") && seen.has("b") && seen.has("g")).toBe(true); // red → blue → lime
  });

  test("pause freezes on the still; play resumes the animation", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "desktop-gif");
    const toggle = page.locator(TOGGLE);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAccessibleName("Pause animation");
    await expect.poll(() => currentSrc(page, HERO)).toMatch(/animated\.gif$/);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAccessibleName("Play animation");
    await expect
      .poll(() => currentSrc(page, HERO))
      .toMatch(/800w\.(webp|jpg)$/);
    expect(new Set(await frames(page, HERO, 8))).toEqual(new Set(["r"]));

    await toggle.click();
    await expect.poll(() => currentSrc(page, HERO)).toMatch(/animated\.gif$/);
  });

  test("Arabic RTL: control sits at the inline end and is keyboard operable", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "desktop-gif", "ar");
    const toggle = page.locator(TOGGLE);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const box = await toggle.boundingBox();
    const hero = await page.locator("[data-testid=hero]").boundingBox();
    if (!box || !hero) throw new Error("no layout");
    expect(box.x).toBeLessThan(hero.x + hero.width / 2); // RTL ⇒ inline-end is the left half
    expect(box.width).toBeGreaterThanOrEqual(40); // 44px-class touch target
  });

  test("reduced motion: the still is used, the animation is NEVER requested, no control", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "desktop-gif");
    await page.waitForLoadState("networkidle");
    await expect
      .poll(() => currentSrc(page, HERO))
      .toMatch(/800w\.(webp|jpg)$/);
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    await expect(page.locator(TOGGLE)).toHaveCount(0);
    await context.close();
  });

  test("no JavaScript: the still only — no animation fetched, no motion without a control", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "desktop-gif");
    await page.waitForLoadState("networkidle");
    expect(await currentSrc(page, HERO)).toMatch(/800w\.(webp|jpg)$/);
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          (document.querySelector("[data-sd-backdrop] img") as HTMLImageElement)
            .naturalWidth,
      ),
    ).toBeGreaterThan(0);
    await expect(page.locator("button")).toHaveCount(0);
    await context.close();
  });

  test("animated WebP: the sanitised file is fetched, decodes and renders in the browser", async ({
    page,
  }) => {
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "desktop-webp");
    await page.waitForSelector(TOGGLE);
    await expect.poll(() => currentSrc(page, HERO)).toMatch(/animated\.webp$/);
    // decoded and rendered at the right size (a broken/truncated sanitised file would not decode)
    expect(
      await page.evaluate(
        (sel) => (document.querySelector(sel) as HTMLImageElement).naturalWidth,
        HERO,
      ),
    ).toBe(400);
  });

  test("animated WebP playback: frames really change (skipped where the browser cannot animate)", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "desktop-webp");
    await page.waitForSelector(TOGGLE);
    await expect.poll(() => currentSrc(page, HERO)).toMatch(/animated\.webp$/);
    test.skip(
      !(await browserAnimates(page)),
      "this Chromium build does not advance animated images (control GIF stayed on frame 0)",
    );
    expect(new Set(await frames(page, HERO)).size).toBeGreaterThanOrEqual(3);
  });

  test("the still extracted from an animated WebP's first frame decodes as a full-canvas red image", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await page.goto("/dev/animated-media-visual?scenario=static");
    const result = await page.evaluate(async () => {
      const img = new Image();
      img.src = "/api/storefront/media/customizer/x/first-frame.webp";
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d");
      ctx.drawImage(img, 0, 0, 1, 1);
      return {
        w: img.naturalWidth,
        h: img.naturalHeight,
        px: Array.from(ctx.getImageData(0, 0, 1, 1).data),
      };
    });
    expect([result.w, result.h]).toEqual([400, 400]);
    expect(result.px[0]).toBeGreaterThan(200);
    expect(result.px[2]).toBeLessThan(60);
  });

  test("phone art direction: a phone-only animation plays on a phone and not on desktop", async ({
    browser,
  }) => {
    const desktopLog: string[] = [];
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const dp = await desktop.newPage();
    await serveMedia(dp, desktopLog);
    await open(dp, "phone-gif");
    await dp.waitForLoadState("networkidle");
    expect(await currentSrc(dp, HERO)).toMatch(/800w\.(webp|jpg)$/);
    expect(desktopLog.filter((f) => f.startsWith("animated."))).toEqual([]);
    await desktop.close();

    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    const pp = await phone.newPage();
    await serveMedia(pp, []);
    await open(pp, "phone-gif");
    await pp.waitForSelector(TOGGLE);
    await expect.poll(() => currentSrc(pp, HERO)).toMatch(/animated\.gif$/);
    const box = await pp.locator(TOGGLE).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(
      await pp.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true); // no horizontal scroll
    await phone.close();
  });

  test("slider: animated slide plays, the toggle lives in the control bar, pausing shows the still", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "slider");
    const toggle = page.locator(`[data-slider-bar] ${TOGGLE}`);
    await expect(toggle).toBeVisible();
    await expect.poll(() => currentSrc(page, SLIDE)).toMatch(/animated\.gif$/);
    await toggle.click();
    await expect.poll(() => currentSrc(page, SLIDE)).toMatch(/\.(webp|jpg)$/);
    expect(await currentSrc(page, SLIDE)).not.toMatch(/animated/);
  });

  test("static section: byte-for-byte the old behaviour — no animation request, no control", async ({
    page,
  }) => {
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "static");
    await page.waitForLoadState("networkidle");
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    await expect(page.locator(TOGGLE)).toHaveCount(0);
  });

  // ── gallery (AWJ-ANIMATED-MEDIA, PR #1652) ─────────────────────────────────────────────────────
  const GAL = "[data-gallery-item]:first-child [data-gallery-picture] img";
  const GAL_STILL =
    "[data-gallery-item]:nth-child(2) [data-gallery-picture] img";
  const VIEWER_IMG = "[data-gallery-viewer] img";

  test("gallery GIF: still first, then the animation; the still neighbour is untouched; no hydration errors", async ({
    page,
  }) => {
    const log: string[] = [];
    const errors = watchErrors(page);
    await serveMedia(page, log);
    await open(page, "gallery-gif");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    expect(await currentSrc(page, GAL_STILL)).toMatch(/800w\.(webp|jpg)$/);
    expect(
      await page.evaluate(
        (sel) => (document.querySelector(sel) as HTMLImageElement).naturalWidth,
        GAL,
      ),
    ).toBeGreaterThan(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("gallery GIF playback: frames really change (skipped where the browser cannot animate a control GIF)", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "gallery-gif");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    test.skip(
      !(await browserAnimates(page)),
      "this Chromium build does not advance animated images",
    );
    const seen = new Set(await frames(page, GAL));
    expect(seen.has("r") && seen.has("b") && seen.has("g")).toBe(true);
  });

  test("gallery animated WebP decodes and renders at the right size", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "gallery-webp");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.webp$/);
    expect(
      await page.evaluate(
        (sel) => (document.querySelector(sel) as HTMLImageElement).naturalWidth,
        GAL,
      ),
    ).toBe(400);
  });

  test("gallery default (showMotionControls off): no pause button; the animation settles on the still after the 5 s window", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "gallery-gif");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    await expect(page.locator(TOGGLE)).toHaveCount(0);
    await expect(page.locator("[data-gallery-motion]")).toHaveCount(0);
    // WCAG 2.2.2: never longer than ~5 s of automatic motion without a control
    await expect
      .poll(() => currentSrc(page, GAL), { timeout: 9_000 })
      .toMatch(/800w\.(webp|jpg)$/);
    expect(await currentSrc(page, GAL)).not.toMatch(/animated/);
  });

  test("gallery with showMotionControls: one control pauses and resumes, keyboard operable, nothing auto-settles", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "gallery-controls");
    const toggle = page.locator(`[data-gallery-motion] ${TOGGLE}`);
    await expect(toggle).toHaveCount(1);
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    await page.waitForTimeout(6_500); // past the default window
    expect(await currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/800w\.(webp|jpg)$/);
    await page.keyboard.press("Enter");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    const box = await toggle.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
  });

  test("gallery control sits at the inline end of the gallery, in LTR and RTL", async ({
    page,
  }) => {
    await serveMedia(page, []);
    for (const [locale, inlineEndIsRight] of [
      ["en", true],
      ["ar", false],
    ] as const) {
      await open(page, "gallery-controls", locale);
      const toggle = page.locator(`[data-gallery-motion] ${TOGGLE}`);
      await expect(toggle).toBeVisible();
      const box = await toggle.boundingBox();
      const gallery = await page.locator("[data-gallery]").boundingBox();
      if (!box || !gallery) throw new Error("no layout");
      const midpoint = gallery.x + gallery.width / 2;
      expect(box.x + box.width / 2 > midpoint).toBe(inlineEndIsRight);
    }
  });

  test("gallery lightbox: opens on the animation, shares the control, closes back to the opener", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "gallery-controls");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    await page.locator("a[data-gallery-open='0']").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => currentSrc(page, VIEWER_IMG))
      .toMatch(/animated\.gif$/);
    const viewerToggle = dialog.locator(TOGGLE);
    await expect(viewerToggle).toHaveAccessibleName("Pause animation");
    await viewerToggle.click();
    await expect
      .poll(() => currentSrc(page, VIEWER_IMG))
      .toMatch(/\.(webp|jpg)$/);
    // next ⇒ the still picture has no control; previous ⇒ back on the (paused) animated one
    await page.getByRole("button", { name: "Next picture" }).click();
    await expect(dialog.locator(TOGGLE)).toHaveCount(0);
    expect(await currentSrc(page, VIEWER_IMG)).toMatch(/\.(webp|jpg)$/);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("gallery reduced motion: stills only, the animation is NEVER requested, no control", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "gallery-controls");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/800w\.(webp|jpg)$/);
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    await expect(page.locator(TOGGLE)).toHaveCount(0);
    await context.close();
  });

  test("gallery without JavaScript: the still only, nothing fetched, no dead control", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "gallery-controls");
    await page.waitForLoadState("networkidle");
    expect(await currentSrc(page, GAL)).toMatch(/800w\.(webp|jpg)$/);
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    await expect(page.locator("[data-motion-toggle]")).toHaveCount(0);
    await context.close();
  });

  test("gallery on a phone: no horizontal scroll, the control is a touch-sized target inside the gallery", async ({
    browser,
  }) => {
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    const page = await phone.newPage();
    await serveMedia(page, []);
    await open(page, "gallery-controls");
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    const box = await page
      .locator(`[data-gallery-motion] ${TOGGLE}`)
      .boundingBox();
    const gallery = await page.locator("[data-gallery]").boundingBox();
    if (!box || !gallery) throw new Error("no layout");
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.x).toBeGreaterThanOrEqual(gallery.x);
    expect(box.x + box.width).toBeLessThanOrEqual(gallery.x + gallery.width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await phone.close();
  });

  test("static gallery: byte-for-byte the old behaviour — no animation request, no control", async ({
    page,
  }) => {
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "gallery-static");
    await page.waitForLoadState("networkidle");
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    await expect(page.locator(TOGGLE)).toHaveCount(0);
    await expect(page.locator("[data-gallery-motion]")).toHaveCount(0);
  });

  // ── gallery: an off-screen picture is neither fetched nor timed (review follow-up on #1652) ──────────
  test("gallery off-screen (no control): the animation is NOT fetched while below the fold; scrolling in starts it, and it settles ~5 s later", async ({
    page,
  }) => {
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "gallery-offscreen");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(6_500); // longer than the whole window: nothing may have started or been spent
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    expect(await currentSrc(page, GAL)).toMatch(/800w\.(webp|jpg)$/);

    await page.locator("[data-gallery]").scrollIntoViewIfNeeded();
    const shown = Date.now();
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    expect(log.filter((f) => f.startsWith("animated.")).length).toBeGreaterThan(
      0,
    );
    await expect
      .poll(() => currentSrc(page, GAL), { timeout: 9_000 })
      .toMatch(/800w\.(webp|jpg)$/);
    const playedMs = Date.now() - shown;
    // the window is measured from when motion began: not instant, and not far beyond 5 s
    expect(playedMs).toBeGreaterThan(3_500);
    expect(playedMs).toBeLessThan(8_500);
  });

  test("gallery off-screen with reduced motion: scrolling in still never requests the animation", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "gallery-offscreen");
    await page.locator("[data-gallery]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_500);
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/800w\.(webp|jpg)$/);
    expect(log.filter((f) => f.startsWith("animated."))).toEqual([]);
    await context.close();
  });

  test("gallery off-screen WITH the control: behaviour is unchanged — the animation is added at hydration and nothing auto-settles", async ({
    page,
  }) => {
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "gallery-offscreen-controls");
    await expect
      .poll(() => log.some((f) => f.startsWith("animated.")))
      .toBe(true);
    await page.locator("[data-gallery]").scrollIntoViewIfNeeded();
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    await page.waitForTimeout(6_500);
    expect(await currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    await expect(page.locator(`[data-gallery-motion] ${TOGGLE}`)).toHaveCount(
      1,
    );
  });

  test("gallery viewer (no control): a window spent in the grid stays spent in the viewer; an unspent picture gets its own window there", async ({
    page,
  }) => {
    const log: string[] = [];
    await serveMedia(page, log);
    await open(page, "gallery-gif");
    // the animation really starts, then the grid window is spent
    await expect.poll(() => currentSrc(page, GAL)).toMatch(/animated\.gif$/);
    await expect
      .poll(() => currentSrc(page, GAL), { timeout: 9_000 })
      .toMatch(/800w\.(webp|jpg)$/);
    await page.locator("a[data-gallery-open='0']").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await currentSrc(page, VIEWER_IMG)).toMatch(/\.(webp|jpg)$/);
    expect(await currentSrc(page, VIEWER_IMG)).not.toMatch(/animated/);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("gallery viewer (no control): opening a picture whose grid window is unspent plays it in the viewer and settles ~5 s later", async ({
    page,
  }) => {
    await serveMedia(page, []);
    await open(page, "gallery-offscreen"); // grid picture below the fold ⇒ its window has not started
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      (
        document.querySelector("a[data-gallery-open='0']") as HTMLElement
      ).click();
    });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => currentSrc(page, VIEWER_IMG))
      .toMatch(/animated\.gif$/);
    const shown = Date.now();
    await expect
      .poll(() => currentSrc(page, VIEWER_IMG), { timeout: 9_000 })
      .not.toMatch(/animated/);
    expect(Date.now() - shown).toBeGreaterThan(3_500);
  });
});
