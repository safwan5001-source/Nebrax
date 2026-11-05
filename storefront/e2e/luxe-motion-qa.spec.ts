import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * AWJ Luxe Motion — final visual / functional / accessibility QA.
 *
 * Drives the REAL storefront routes (home, category, product, header, footer, bottom nav, quick view, gallery, cart
 * action) in a real browser against `e2e/support/luxe-motion-api-fixture.mjs` (synthetic neutral catalogue, in-memory
 * cart). No unit-test mocks of the components under test. Run with `playwright.luxe-qa.config.ts`.
 *
 * `LUXE_QA_PRESET=modern` re-runs the same matrix against a fixture that publishes AWJ Modern, so the Luxe-only
 * assertions flip to "must be absent" (isolation) and the axe results can be diffed to separate pre-existing issues
 * from anything this theme introduced.
 */

const FIXTURE = "http://127.0.0.1:4120";
const PRESET: "luxe" | "luxe-bare" | "modern" =
  process.env.LUXE_QA_PRESET === "modern"
    ? "modern"
    : process.env.LUXE_QA_PRESET === "luxe-bare"
      ? "luxe-bare"
      : "luxe";
const IS_LUXE = PRESET !== "modern";
/** Global card tokens (`cards.hover: "zoom"`) are published, so they own the hover treatment. */
const HAS_TOKENS = PRESET === "luxe";
const evidenceDir = path.resolve(
  process.cwd(),
  "test-results/luxe-motion-qa",
  PRESET,
);

// axe-core is a devDependency of `web/` (not of this package); this on-demand QA spec borrows it so the storefront's
// lockfile stays untouched. Run `npm ci` in `web/` first.
const nodeRequire = createRequire(
  path.resolve(process.cwd(), "../web/package.json"),
);
const AXE_PATH = nodeRequire.resolve("axe-core/axe.min.js");

const VIEWPORTS = [
  { name: "iphone-390", width: 390, height: 844, mobile: true },
  { name: "iphone-430", width: 430, height: 932, mobile: true },
  { name: "small-320", width: 320, height: 568, mobile: true },
  { name: "desktop-1440", width: 1440, height: 900, mobile: false },
] as const;
const LOCALES = ["ar", "en"] as const;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Let entrance reveals/ transitions finish (Luxe uses slow/emphasized motion).
  await page.waitForTimeout(900);
}

async function shot(page: Page, name: string, fullPage = false) {
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDir, `${name}.png`),
    fullPage,
  });
}

async function noHorizontalOverflow(page: Page) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bw: document.body.scrollWidth,
  }));
  expect(
    m.sw,
    "document scrollWidth must not exceed the viewport",
  ).toBeLessThanOrEqual(m.cw);
  expect(m.bw).toBeLessThanOrEqual(m.cw);
}

async function expectDirection(page: Page, locale: string) {
  const d = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
  }));
  expect(d.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  expect(d.lang).toBe(locale);
}

type AxeResult = {
  violations: {
    id: string;
    impact: string | null;
    nodes: { target: unknown[]; html: string }[];
  }[];
};

async function runAxe(page: Page, label: string) {
  await page.addScriptTag({ path: AXE_PATH });
  const result = (await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: { run: (...a: unknown[]) => Promise<unknown> };
      }
    ).axe;
    return await axe.run(
      { exclude: [["nextjs-portal"], ["[data-nextjs-dialog-overlay]"]] },
      {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
      },
    );
  })) as AxeResult;
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, `axe-${label}.json`),
    JSON.stringify(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        count: v.nodes.length,
        sample: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 140)),
      })),
      null,
      2,
    ),
  );
  return result.violations;
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "element must be rendered").not.toBeNull();
  return b as { x: number; y: number; width: number; height: number };
}

/** Largest layout shift score accumulated since `installCls`. */
async function installCls(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as {
        hadRecentInput: boolean;
        value: number;
      }[]) {
        if (!e.hadRecentInput) w.__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}
const readCls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cls: number }).__cls);

async function resetCart() {
  await fetch(`${FIXTURE}/__qa/reset`);
}
async function cartState(): Promise<{
  items: { quantity: number; product_id: string }[];
  posts: number;
}> {
  return (await fetch(`${FIXTURE}/__qa/cart`)).json();
}

for (const vp of VIEWPORTS) {
  for (const locale of LOCALES) {
    test.describe(`${PRESET} · ${vp.name} · ${locale}`, () => {
      test.use({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
        deviceScaleFactor: vp.mobile ? 2 : 1,
        locale: locale === "ar" ? "ar-SA" : "en-US",
      });
      const base = `/sa/${locale}`;
      const tag = `${vp.name}-${locale}`;

      test("home: header, hero, categories, product cards, footer", async ({
        page,
      }) => {
        await installCls(page);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base, { waitUntil: "networkidle" });
        await settle(page);

        await expectDirection(page, locale);
        await noHorizontalOverflow(page);

        // Header + navigation.
        const header = page.locator("header").first();
        await expect(header).toBeVisible();
        await expect(
          page.getByRole("searchbox").or(header.locator("input")).first(),
        ).toBeVisible();
        await expect(
          header.locator("a", { hasText: "AWJ QA Store" }).first(),
        ).toBeVisible();
        // Hero + categories + cards.
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const cards = page.locator("[data-card]");
        expect(await cards.count()).toBeGreaterThanOrEqual(8);
        await expect(page.locator("footer").first()).toBeAttached();

        // Luxe-only card treatment is present for Luxe and absent for Modern (isolation).
        const hoverClass = await cards
          .first()
          .evaluate((el) => el.className.includes("hover:-translate-y-0.5"));
        expect(hoverClass).toBe(IS_LUXE);

        // Touch targets of the Luxe card actions (44px) — Luxe only.
        if (IS_LUXE) {
          const quickView = cards
            .first()
            .getByRole("button", { name: /quick view|معاينة سريعة/i });
          if (await quickView.count()) {
            const b = await box(quickView.first());
            expect(b.width).toBeGreaterThanOrEqual(44);
            expect(b.height).toBeGreaterThanOrEqual(44);
          }
          const ctas = cards.locator(
            "button:not([aria-label]), a.border-store-primary",
          );
          const n = await ctas.count();
          for (let i = 0; i < n; i++) {
            const b = await ctas.nth(i).boundingBox();
            if (b) expect(b.height).toBeGreaterThanOrEqual(43.5);
          }
        }

        // Image loading: everything well below the fold is lazy, and the page never ships a runaway image count.
        const imgs = await page.evaluate(() =>
          [...document.images].map((i) => ({
            lazy: i.loading === "lazy",
            top: i.getBoundingClientRect().top + window.scrollY,
            vh: window.innerHeight,
          })),
        );
        const farBelow = imgs.filter((i) => i.top > i.vh * 2.5);
        for (const i of farBelow)
          expect(i.lazy, "far-below-fold image must be lazy").toBe(true);
        expect(imgs.length, "image elements on home").toBeLessThanOrEqual(40);

        // Layout stability + page errors.
        expect(await readCls(page), "cumulative layout shift").toBeLessThan(
          0.1,
        );
        expect(errors, "uncaught page errors").toEqual([]);

        // Accessibility (WCAG 2.2 AA): no critical findings.
        const violations = await runAxe(page, `home-${tag}`);
        expect(violations.filter((v) => v.impact === "critical")).toEqual([]);

        await shot(page, `home-top-${tag}`);
        await shot(page, `home-full-${tag}`, true);
      });

      test("home: product rail — flush start edge, uniform gap, next/previous follow reading direction", async ({
        page,
      }) => {
        await page.goto(base, { waitUntil: "networkidle" });
        await settle(page);
        const rail = page.locator(".product-carousel").first();
        await rail.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        const rtl = locale === "ar";
        const read = () =>
          rail.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const slides = [...el.querySelectorAll(".swiper-slide")]
              .slice(0, 3)
              .map((s) => {
                const q = s.getBoundingClientRect();
                return { l: q.left, r: q.right };
              });
            // Swiper exposes the gap configured for the active breakpoint.
            const space = Number(
              (
                el as unknown as {
                  swiper: { params: { spaceBetween: number } };
                }
              ).swiper.params.spaceBetween,
            );
            return { l: r.left, r: r.right, slides, space };
          });
        const g0 = await read();
        // First slide is flush with the start edge of the rail (no stray inline margin on the start side).
        if (rtl) expect(Math.abs(g0.r - g0.slides[0].r)).toBeLessThan(1.5);
        else expect(Math.abs(g0.l - g0.slides[0].l)).toBeLessThan(1.5);
        // Gap between slides equals the configured spaceBetween, not double.
        const gap = rtl
          ? g0.slides[0].l - g0.slides[1].r
          : g0.slides[1].l - g0.slides[0].r;
        expect(Math.abs(gap - g0.space), "slide gap").toBeLessThan(1.5);
        await noHorizontalOverflow(page);

        // Nothing invisible may sit on top of the slides' own controls: every visible Quick View in the rail must be
        // the element a tap at its centre actually reaches (the hidden "previous" arrow used to swallow it).
        const hitTestQuickViews = () =>
          rail.evaluate((el) => {
            el.scrollIntoView({ block: "center" });
            const out: { label: string; hit: string }[] = [];
            for (const qv of el.querySelectorAll<HTMLElement>(
              "button[aria-label]",
            )) {
              if (
                !/quick view|معاينة سريعة/i.test(
                  qv.getAttribute("aria-label") ?? "",
                )
              )
                continue;
              const r = qv.getBoundingClientRect();
              if (r.right <= 0 || r.left >= window.innerWidth) continue;
              if (r.top < 0 || r.bottom > window.innerHeight) continue;
              // Slides beyond the rail's clipped edge are not visible controls.
              const rr = el.getBoundingClientRect();
              const cx = r.left + r.width / 2;
              if (cx < rr.left || cx > rr.right) continue;
              const hit = document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2,
              );
              out.push({
                label: qv.getAttribute("aria-label") ?? "",
                hit:
                  hit && (hit === qv || qv.contains(hit))
                    ? "ok"
                    : (hit?.closest("button")?.getAttribute("aria-label") ??
                      hit?.tagName ??
                      "none"),
              });
            }
            return out;
          });
        const quickViews = await hitTestQuickViews();
        if (IS_LUXE) expect(quickViews.length).toBeGreaterThan(0);
        expect(quickViews.filter((q) => q.hit !== "ok")).toEqual([]);

        // Next moves the track toward the end of the reading direction; previous is hidden at the start.
        const next = page.getByRole("button", {
          name: /next products|المنتجات التالية|التالي/i,
        });
        const prev = page.getByRole("button", {
          name: /previous products|المنتجات السابقة|السابق/i,
        });
        await expect(next).toBeVisible();
        await expect(prev).toBeDisabled();
        const nb = await box(next);
        expect(Math.min(nb.width, nb.height)).toBeGreaterThanOrEqual(24);
        await next.click();
        await page.waitForTimeout(700);
        const g1 = await read();
        if (rtl)
          expect(g1.slides[0].r, "RTL: track moves right").toBeGreaterThan(
            g0.slides[0].r + 20,
          );
        else
          expect(g1.slides[0].l, "LTR: track moves left").toBeLessThan(
            g0.slides[0].l - 20,
          );
        await expect(prev).toBeEnabled();
        // With both arrows now visible, they must still not sit on top of a card's Quick View.
        const afterAdvance = await hitTestQuickViews();
        expect(afterAdvance.filter((q) => q.hit !== "ok")).toEqual([]);
        await shot(page, `rail-${tag}`);
      });

      test("category: grid, long names, sort, overflow", async ({ page }) => {
        await page.goto(`${base}/products`, { waitUntil: "networkidle" });
        await settle(page);
        await expectDirection(page, locale);
        await noHorizontalOverflow(page);

        const cards = page.locator("[data-card]");
        expect(await cards.count()).toBeGreaterThanOrEqual(8);

        // Column count: 2 on phones, more on desktop; cards never overlap horizontally.
        const xs = new Set<number>();
        const n = await cards.count();
        for (let i = 0; i < Math.min(n, 8); i++) {
          const b = await box(cards.nth(i));
          xs.add(Math.round(b.x));
          expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
          expect(b.x).toBeGreaterThanOrEqual(-0.5);
        }
        if (vp.mobile) expect(xs.size).toBe(2);
        else expect(xs.size).toBeGreaterThanOrEqual(3);

        // Long product name is clamped to two lines and never widens the card.
        const long = cards
          .filter({ hasText: /ديكور منزلي متكاملة|Complete Contemporary/ })
          .first();
        const title = long.locator("h3");
        const lh = await title.evaluate((el) => ({
          h: el.getBoundingClientRect().height,
          line: parseFloat(getComputedStyle(el).lineHeight),
          clamp: getComputedStyle(el).webkitLineClamp,
        }));
        expect(lh.clamp).toBe("2");
        // Two clamped lines plus fallback-font line-box slack; a third line (≥ 3×) would mean the clamp failed.
        expect(lh.h).toBeLessThanOrEqual(lh.line * 2.5);

        // Equal-height rows (stretch) so the CTA row aligns.
        const heights = await cards.evaluateAll((els) =>
          els
            .slice(0, 2)
            .map((e) => Math.round(e.getBoundingClientRect().height)),
        );
        expect(heights[0]).toBe(heights[1]);

        // Sort control is reachable and opens.
        const sort = page
          .getByRole("button", { name: /sort|ترتيب|فرز/i })
          .first();
        await expect(sort).toBeVisible();
        await sort.click();
        await expect(
          page
            .getByRole("menu")
            .or(page.getByRole("listbox"))
            .or(page.getByRole("dialog"))
            .first(),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          page
            .getByRole("menu")
            .or(page.getByRole("listbox"))
            .or(page.getByRole("dialog")),
        ).toHaveCount(0);

        // Unavailable product shows the muted out-of-stock state (not an active CTA).
        const oos = cards
          .filter({ hasText: /Hydrating Care Cream|كريم عناية مرطب/ })
          .first();
        await expect(oos.locator("button:has-text('Add to cart')")).toHaveCount(
          0,
        );

        const violations = await runAxe(page, `category-${tag}`);
        expect(violations.filter((v) => v.impact === "critical")).toEqual([]);
        await shot(page, `category-top-${tag}`);
        await shot(page, `category-full-${tag}`, true);
      });

      test("product: simple — gallery, price, quantity, add to cart, purchase bar", async ({
        page,
      }) => {
        await resetCart();
        await installCls(page);
        // Headless Chromium has no share sheet: stub the platform API so the hand-off can be asserted.
        await page.addInitScript(() => {
          navigator.share = async (data?: ShareData) => {
            (window as unknown as { __shared?: unknown }).__shared = data;
          };
        });
        await page.goto(`${base}/products/p1`, { waitUntil: "networkidle" });
        await settle(page);
        await expectDirection(page, locale);
        await noHorizontalOverflow(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, `pdp-top-${tag}`);
        await page.evaluate(() => window.scrollTo(0, 500));
        await shot(page, `pdp-scrolled-${tag}`);
        await page.evaluate(() => window.scrollTo(0, 0));

        const h1 = page.getByRole("heading", { level: 1 });
        const h1px = await h1.evaluate((el) =>
          parseFloat(getComputedStyle(el).fontSize),
        );
        if (IS_LUXE) expect(h1px).toBeGreaterThanOrEqual(24);
        else expect(h1px).toBeLessThan(24);

        // Gallery: thumbnails swap the main image; main image is not distorted.
        const zoom = page.getByRole("button", { name: /zoom|تكبير/i }).first();
        const mainImg = zoom.locator("img").first();
        const before = await mainImg.evaluate(
          (i: HTMLImageElement) => i.currentSrc,
        );
        const thumbs = page.locator("button:has(img):not([aria-label])");
        const thumbCount = await thumbs.count();
        expect(thumbCount).toBeGreaterThanOrEqual(3);
        await thumbs.nth(2).click();
        await expect
          .poll(() => mainImg.evaluate((i: HTMLImageElement) => i.currentSrc))
          .not.toBe(before);
        const ratio = await mainImg.evaluate((i: HTMLImageElement) => {
          const r = i.getBoundingClientRect();
          return {
            cw: r.width,
            ch: r.height,
            fit: getComputedStyle(i).objectFit,
          };
        });
        expect(["cover", "contain"]).toContain(ratio.fit);

        // Quantity controls (44px buttons) + clamp at 1.
        const inc = page.getByRole("button", {
          name: /increase quantity|زيادة/i,
        });
        const dec = page.getByRole("button", {
          name: /decrease quantity|تقليل|إنقاص/i,
        });
        const qty = page
          .getByRole("spinbutton")
          .or(page.locator("input[inputmode='numeric'], input[type='number']"))
          .first();
        for (const b of [inc, dec]) {
          const bb = await box(b);
          expect(bb.width).toBeGreaterThanOrEqual(43.5);
          expect(bb.height).toBeGreaterThanOrEqual(43.5);
        }
        await inc.click();
        await expect(qty).toHaveValue("2");
        await dec.click();
        await expect(qty).toHaveValue("1");
        await expect(dec, "quantity never drops below 1").toBeDisabled();

        // Fixed mobile purchase bar sits above the bottom nav with no overlap; desktop renders it inline.
        const add = page
          .getByRole("button", { name: /^(add to cart|أضف للسلة)/i })
          .first();
        await expect(add).toBeVisible();
        const barPos = await add.evaluate((el) => {
          for (let n: Element | null = el; n; n = n.parentElement) {
            if (getComputedStyle(n).position === "fixed") {
              const r = n.getBoundingClientRect();
              return { fixed: true, top: r.top, bottom: r.bottom };
            }
          }
          return { fixed: false, top: 0, bottom: 0 };
        });
        if (vp.mobile && IS_LUXE) {
          expect(barPos.fixed).toBe(true);
          const nav = page
            .locator("nav[aria-label], nav")
            .filter({ has: page.locator("a") })
            .last();
          const navBox = await box(nav);
          expect(barPos.bottom).toBeLessThanOrEqual(navBox.y + 1);
          // Bar lies fully inside the viewport and never above the sticky header.
          expect(barPos.top).toBeGreaterThan(120);
          // The last content is reachable: scroll to the end; nothing is trapped under the bar.
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          await page.waitForTimeout(200);
          const footerBox = await box(page.locator("footer").first());
          expect(footerBox.y + footerBox.height).toBeGreaterThan(0);
        }
        if (!vp.mobile) expect(barPos.fixed).toBe(false);

        // Wishlist toggles (local, capability-gated) and share hands the product title + canonical URL to the platform
        // share sheet; both ≥ 24px (WCAG 2.5.8) and exposed with an accessible name.
        const wish = page
          .getByRole("button", { name: /favorites|المفضلة/i })
          .first();
        const share = page
          .getByRole("button", { name: /share|مشاركة/i })
          .first();
        if (IS_LUXE) {
          for (const btn of [wish, share]) {
            await expect(btn).toBeVisible();
            const bb = await box(btn);
            expect(Math.min(bb.width, bb.height)).toBeGreaterThanOrEqual(24);
          }
          await expect(wish).toHaveAttribute("aria-pressed", "false");
          await wish.click();
          await expect(wish).toHaveAttribute("aria-pressed", "true");
          await wish.click();
          await expect(wish).toHaveAttribute("aria-pressed", "false");
          await share.click();
          const shared = await page.evaluate(
            () =>
              (
                window as unknown as {
                  __shared?: { url: string; title: string };
                }
              ).__shared,
          );
          expect(shared?.url).toContain("/products/p1");
          expect(shared?.title).toBeTruthy();
        }

        // Add to cart reaches the cart API exactly once with the chosen quantity.
        await page.evaluate(() => window.scrollTo(0, 0));
        await inc.click();
        await add.click();
        await expect.poll(async () => (await cartState()).posts).toBe(1);
        const cart = await cartState();
        expect(cart.items[0]).toMatchObject({ product_id: "p1", quantity: 2 });

        expect(await readCls(page), "cumulative layout shift").toBeLessThan(
          0.15,
        );
        const violations = await runAxe(page, `pdp-${tag}`);
        expect(violations.filter((v) => v.impact === "critical")).toEqual([]);
      });

      test("product: variant-managed — options gate the add action; out-of-stock variant blocked", async ({
        page,
      }) => {
        await resetCart();
        await page.goto(`${base}/products/p2`, { waitUntil: "networkidle" });
        await settle(page);
        await noHorizontalOverflow(page);

        const cta = page
          .getByRole("button", {
            name: /select options|اختر|إضافة|add to cart|أضف للسلة/i,
          })
          .last();
        await expect(cta).toBeVisible();
        // Before choosing: must not be an enabled "Add to cart" that would add the parent.
        const initial = ((await cta.textContent()) ?? "").trim();
        expect(initial).not.toMatch(/^(add to cart|أضف للسلة)$/i);

        const large = page
          .getByRole("button", { name: /^(كبير|large)/i })
          .first();
        // An unavailable value stays selectable but is announced as out of stock and never enables the add action.
        await expect(large).toHaveAccessibleName(/out of stock|غير متوفر|نفد/i);
        await large.click();
        await expect(
          page.getByRole("button", { name: /^(add to cart|أضف للسلة)/i }),
        ).toHaveCount(0);
        expect((await cartState()).posts).toBe(0);

        await page
          .getByRole("button", { name: /^(صغير|small)/i })
          .first()
          .click();
        const add = page
          .getByRole("button", { name: /^(add to cart|أضف للسلة)/i })
          .last();
        await expect(add).toBeEnabled();
        await page.evaluate(() => window.scrollTo(0, 400));
        await shot(page, `pdp-variant-${tag}`);
        await add.click();
        await expect.poll(async () => (await cartState()).posts).toBe(1);
        expect((await cartState()).items[0].product_id).toBe("p2");
      });

      test("product: unavailable — no active purchase action", async ({
        page,
      }) => {
        await resetCart();
        await page.goto(`${base}/products/p5`, { waitUntil: "networkidle" });
        await settle(page);
        await noHorizontalOverflow(page);
        await expect(
          page.getByRole("button", { name: /^(add to cart|أضف للسلة)/i }),
        ).toHaveCount(0);
        const oos = page
          .getByRole("button", { name: /out of stock|غير متوفر|نفد/i })
          .first();
        await expect(oos).toBeVisible();
        await expect(oos).toBeDisabled();
        expect((await cartState()).posts).toBe(0);
        await shot(page, `pdp-unavailable-${tag}`);
      });

      test("product: long name + product without image render safely", async ({
        page,
      }) => {
        for (const id of ["p4", "p10"]) {
          await page.goto(`${base}/products/${id}`, {
            waitUntil: "networkidle",
          });
          await settle(page);
          await noHorizontalOverflow(page);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        }
        await shot(page, `pdp-noimage-${tag}`);
      });
    });
  }
}

/* ── Keyboard, focus, reduced motion, quick view — representative viewports ─────────────────────────────────────── */
for (const locale of LOCALES) {
  test.describe(`${PRESET} · interaction · ${locale}`, () => {
    test.use({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: locale === "ar" ? "ar-SA" : "en-US",
    });
    const base = `/sa/${locale}`;

    test("quick view: opens as a dialog, traps focus, Escape returns focus", async ({
      page,
    }) => {
      test.skip(!IS_LUXE, "Quick view on cards is Luxe/Market only");
      await page.goto(base, { waitUntil: "networkidle" });
      await settle(page);
      const trigger = page
        .locator("[data-card]")
        .first()
        .getByRole("button", { name: /quick view|معاينة سريعة/i });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const name = await dialog.getAttribute("aria-label");
      const labelled = await dialog.getAttribute("aria-labelledby");
      expect(name || labelled, "dialog needs an accessible name").toBeTruthy();
      // Focus is inside the dialog; Tab keeps it there.
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(
          () => !!document.activeElement?.closest("[role='dialog']"),
        );
        expect(inside, "focus must stay trapped in the dialog").toBe(true);
      }
      await shot(page, `quickview-390-${locale}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.activeElement?.getAttribute("aria-label") ?? "",
          ),
        )
        .toMatch(/quick view|معاينة سريعة/i);
    });

    test("keyboard: visible focus ring on card actions and PDP controls", async ({
      page,
    }) => {
      await page.goto(`${base}/products/p1`, { waitUntil: "networkidle" });
      await settle(page);
      const seen = new Set<string>();
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const outline =
            cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1;
          const ring = cs.boxShadow !== "none";
          const within = el.matches(":focus-visible");
          return {
            label: (
              el.getAttribute("aria-label") ||
              el.textContent ||
              el.tagName
            )
              .trim()
              .slice(0, 30),
            visible: within && (outline || ring),
          };
        });
        if (!info) continue;
        seen.add(info.label);
        expect(info.visible, `focus indicator on "${info.label}"`).toBe(true);
      }
      expect(seen.size).toBeGreaterThanOrEqual(6);
    });

    test("reduced motion: hover lift and entrance animations are disabled", async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        // Explicit: contexts created here would otherwise inherit the describe's touch emulation, which disables
        // `(hover: hover)` (and so every `hover:` utility).
        isMobile: false,
        hasTouch: false,
        reducedMotion: "reduce",
        locale: locale === "ar" ? "ar-SA" : "en-US",
      });
      const page = await ctx.newPage();
      await page.goto(base, { waitUntil: "networkidle" });
      await settle(page);
      // No infinite animations anywhere.
      const infinite = await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                (a.effect as KeyframeEffect | null)?.getComputedTiming()
                  .iterations === Infinity,
            ).length,
      );
      expect(infinite).toBe(0);
      const card = page.locator("[data-card]").first();
      await card.scrollIntoViewIfNeeded();
      const top0 = (await box(card)).y;
      await card.hover();
      await page.waitForTimeout(500);
      const top1 = (await box(card)).y;
      expect(
        Math.abs(top1 - top0),
        "no hover lift under reduced motion",
      ).toBeLessThan(0.6);
      await ctx.close();
    });

    test("motion enabled: card hover follows the published treatment (token zoom, or preset lift when no tokens)", async ({
      browser,
    }) => {
      test.skip(!IS_LUXE, "Luxe-only motion");
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        // Explicit: contexts created here would otherwise inherit the describe's touch emulation, which disables
        // `(hover: hover)` (and so every `hover:` utility).
        isMobile: false,
        hasTouch: false,
        reducedMotion: "no-preference",
        locale: locale === "ar" ? "ar-SA" : "en-US",
      });
      const page = await ctx.newPage();
      // The listing page: its cards carry only the document-level card tokens (home sections may add their own).
      await page.goto(`${base}/products`, { waitUntil: "networkidle" });
      await settle(page);
      const card = page.locator("[data-card]").first();
      await card.scrollIntoViewIfNeeded();
      const top0 = (await box(card)).y;
      const img = card.locator("[data-card-image] img").first();
      const scale0 = await img.evaluate((el) => getComputedStyle(el).scale);
      await card.hover();
      await page.waitForTimeout(600);
      const top1 = (await box(card)).y;
      const scale1 = await img.evaluate((el) => getComputedStyle(el).scale);
      if (HAS_TOKENS) {
        // `cards.hover: "zoom"` is published: the token layer wins over the preset's own lift (by design).
        expect(Math.abs(top0 - top1)).toBeLessThan(0.6);
        expect(Number.parseFloat(scale1)).toBeGreaterThan(
          Number.parseFloat(scale0 === "none" ? "1" : scale0),
        );
      } else {
        // Preset only: the Luxe card's own ≈2px lift applies.
        expect(top0 - top1, "hover lift ≈ 2px").toBeGreaterThan(1);
      }
      await ctx.close();
    });

    test("RTL/LTR: logical-direction layout mirrors the PDP purchase bar and breadcrumbs", async ({
      page,
    }) => {
      await page.goto(`${base}/products/p1`, { waitUntil: "networkidle" });
      await settle(page);
      const add = page
        .getByRole("button", { name: /^(add to cart|أضف للسلة)/i })
        .first();
      const dec = page.getByRole("button", {
        name: /decrease quantity|تقليل|إنقاص/i,
      });
      const addBox = await box(add);
      const decBox = await box(dec);
      // The bar mirrors with the document direction (quantity first in reading order, the action after it):
      // LTR ⇒ action to the right of the quantity, RTL ⇒ to the left.
      if (locale === "ar") expect(addBox.x).toBeLessThan(decBox.x);
      else expect(addBox.x).toBeGreaterThan(decBox.x);
      // Product title alignment follows the direction.
      const align = await page
        .getByRole("heading", { level: 1 })
        .evaluate((el) => getComputedStyle(el).textAlign);
      expect(["start", locale === "ar" ? "right" : "left"]).toContain(align);
    });
  });
}
