import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * COPS-H4 Buyer Ordering UX — the intake notices in a REAL browser (Chromium), on the real `OrderingBanner` and
 * `OrderingCartNotice` mounted at `/dev/ordering-visual`. Mobile (390) and desktop (1440), Arabic (RTL) and English (LTR).
 *
 * What is asserted: the right message for the right state, direction, no horizontal overflow, accessible structure (a
 * labelled region — not an alert), a reachable checkout action that is NEVER disabled (the server is the only authority),
 * and that an accepting store with no minimum shows nothing at all.
 *
 * Not covered here: Safari/iOS and Firefox (not available in this environment).
 */
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const locales = ["ar", "en"] as const;
const shots = process.env.ORDERING_QA_SHOTS;

const copy = {
  ar: {
    pausedTitle: "المتجر لا يستقبل طلبات جديدة حالياً",
    outsideTitle: "المتجر خارج ساعات العمل حالياً",
    existing: "هذا لا يؤثر على الطلبات التي قدّمتها سابقاً",
    minimum: "الحد الأدنى للطلب:",
    minimumDelivery: "الحد الأدنى لطلبات التوصيل:",
    shortfall: "أضف منتجات بقيمة",
    pickup: "الاستلام من المتجر غير مشمول بالحد الأدنى.",
    notAccepting:
      "المتجر لا يستقبل طلبات جديدة حالياً. يمكنك إبقاء المنتجات في السلة",
    cta: "إتمام الطلب",
  },
  en: {
    pausedTitle: "The store is not taking new orders right now",
    outsideTitle: "The store is outside its opening hours",
    existing: "This does not affect orders you have already placed",
    minimum: "Minimum order:",
    minimumDelivery: "Minimum order for delivery:",
    shortfall: "Add at least",
    pickup: "Store pickup is not subject to the minimum.",
    notAccepting:
      "The store is not taking new orders right now. You can keep your items",
    cta: "Proceed to checkout",
  },
} as const;

async function open(
  page: Page,
  scenario: string,
  locale: "ar" | "en",
  viewport: (typeof viewports)[number],
) {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto(`/dev/ordering-visual?scenario=${scenario}&locale=${locale}`);
  await expect(page.locator(`[data-scenario="${scenario}"]`)).toBeVisible();
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    fullPage: true,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectCheckoutNeverBlocked(page: Page, locale: "ar" | "en") {
  const cta = page.getByTestId("checkout-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toHaveText(copy[locale].cta);
  await expect(cta).not.toHaveAttribute("aria-disabled", "true");
  await expect(cta).not.toHaveAttribute("disabled", /.*/);
  // Reachable: inside the viewport horizontally, and tall enough to tap.
  const box = await cta.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

for (const viewport of viewports) {
  for (const locale of locales) {
    const t = copy[locale];
    const dir = locale === "ar" ? "rtl" : "ltr";

    test.describe(`${viewport.name} · ${locale}`, () => {
      test("paused store: banner explains it, keeps browsing open, and reassures about existing orders", async ({
        page,
      }) => {
        await open(page, "paused", locale, viewport);
        const banner = page.locator("[data-ordering-banner='paused']");
        await expect(banner).toBeVisible();
        await expect(
          page.getByRole("region", { name: t.pausedTitle }),
        ).toBeVisible();
        await expect(banner).toContainText(t.existing);
        expect(
          await page.evaluate(
            () => document.documentElement.getAttribute("lang") ?? "",
          ),
        ).toBeDefined();
        expect(await page.locator("[data-scenario]").getAttribute("dir")).toBe(
          dir,
        );
        // A labelled region, never an interrupting alert (scoped: Next's own route announcer is a role="alert").
        await expect(banner.getByRole("alert")).toHaveCount(0);
        await expect(banner).not.toHaveAttribute("role", "alert");
        await expect(banner).not.toHaveAttribute("aria-live", /.*/);
        await expectNoHorizontalOverflow(page);
        await shot(page, `paused-${viewport.name}-${locale}`);
      });

      test("paused with a merchant note and a scheduled resume: shows the note (isolated direction) and a <time>", async ({
        page,
      }) => {
        await open(page, "paused-note", locale, viewport);
        const banner = page.locator("[data-ordering-banner='paused']");
        await expect(banner).toContainText("Closed today for maintenance");
        const note = banner.locator("p[dir='auto']");
        await expect(note).toHaveCount(1);
        const time = banner.locator("time");
        await expect(time).toHaveCount(1);
        await expect(time).toHaveAttribute(
          "datetime",
          "2026-11-09T14:00:00+00:00",
        );
        expect((await time.textContent())?.trim().length ?? 0).toBeGreaterThan(
          5,
        );
        // No text may be clipped or overflow its container.
        const clipped = await banner.evaluate(
          (el) => el.scrollWidth > el.clientWidth + 1,
        );
        expect(clipped).toBe(false);
        await expectNoHorizontalOverflow(page);
        await shot(page, `paused-note-${viewport.name}-${locale}`);
      });

      test("outside opening hours: says so, differently from a pause", async ({
        page,
      }) => {
        await open(page, "outside-hours", locale, viewport);
        await expect(
          page.locator("[data-ordering-banner='outside_hours']"),
        ).toBeVisible();
        await expect(
          page.getByRole("region", { name: t.outsideTitle }),
        ).toBeVisible();
        await expect(page.locator("time")).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await shot(page, `outside-hours-${viewport.name}-${locale}`);
      });

      test("cart below the minimum: shows the minimum and the exact shortfall; checkout stays enabled", async ({
        page,
      }) => {
        await open(page, "cart-min", locale, viewport);
        const notice = page.locator("[data-ordering-cart-notice]");
        await expect(notice).toBeVisible();
        await expect(notice).toContainText(t.minimum);
        await expect(notice.locator("[data-ordering-shortfall]")).toContainText(
          t.shortfall,
        );
        await expect(
          notice.locator("[data-ordering-shortfall]"),
        ).toHaveAttribute("aria-live", "polite");
        await expect(page.locator("[data-ordering-banner]")).toHaveCount(0);
        await expectCheckoutNeverBlocked(page, locale);
        await expectNoHorizontalOverflow(page);
        await shot(page, `cart-min-${viewport.name}-${locale}`);
      });

      test("delivery-only minimum on a pickup order: says it does not apply, no shortfall", async ({
        page,
      }) => {
        await open(page, "cart-pickup", locale, viewport);
        const notice = page.locator("[data-ordering-cart-notice]");
        await expect(notice).toContainText(t.minimumDelivery);
        await expect(notice).toContainText(t.pickup);
        await expect(notice.locator("[data-ordering-shortfall]")).toHaveCount(
          0,
        );
        await expectNoHorizontalOverflow(page);
        await shot(page, `cart-pickup-${viewport.name}-${locale}`);
      });

      test("paused store with a cart: banner AND cart note, and the checkout action is still not disabled", async ({
        page,
      }) => {
        await open(page, "cart-paused", locale, viewport);
        await expect(
          page.locator("[data-ordering-banner='paused']"),
        ).toBeVisible();
        await expect(page.locator("[data-ordering-cart-notice]")).toContainText(
          t.notAccepting,
        );
        await expectCheckoutNeverBlocked(page, locale);
        await expectNoHorizontalOverflow(page);
        await shot(page, `cart-paused-${viewport.name}-${locale}`);
      });

      test("an accepting store with no minimum shows nothing", async ({
        page,
      }) => {
        await open(page, "accepting", locale, viewport);
        await expect(page.locator("[data-ordering-banner]")).toHaveCount(0);
        await expect(page.locator("[data-ordering-cart-notice]")).toHaveCount(
          0,
        );
        await expectCheckoutNeverBlocked(page, locale);
      });
    });
  }
}
