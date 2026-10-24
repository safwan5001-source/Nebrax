import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const OUT = process.env.PAYMENT_QA_SHOTS || join(process.cwd(), "payment-qa-shots");
mkdirSync(OUT, { recursive: true });

const STATES = [
  ["paid", "o-paid"],
  ["pending", "o-pending"],
  ["review", "o-review"],
  ["failed", "o-failed"],
  ["expired", "o-expired"],
  ["cancelled", "o-cancelled"],
  ["awaiting", "o-awaiting"],
] as const;

const VIEWPORTS = [
  ["mobile", { width: 390, height: 844 }],
  ["desktop", { width: 1280, height: 800 }],
] as const;

const LOCALES = ["ar", "en", "de", "es", "fr", "pl"] as const;

async function seed(page: import("@playwright/test").Page, orderId: string | null) {
  await page.addInitScript((id) => {
    if (id === null) return;
    window.localStorage.setItem(
      "awj.pendingOnlinePayment.v1",
      JSON.stringify({ orderId: id, orderReference: "ref-ok", orderNumber: "CORD-1001", savedAt: Date.now() }),
    );
  }, orderId);
}

for (const [vpName, viewport] of VIEWPORTS) {
  for (const locale of LOCALES) {
    // Every state in the two extreme locales (RTL ar, LTR en); the other four are checked on the states that matter most.
    const states = locale === "ar" || locale === "en" ? STATES : STATES.filter(([n]) => ["paid", "failed", "pending"].includes(n));
    for (const [name, orderId] of states) {
      test(`${vpName} ${locale} ${name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await seed(page, orderId);
        await page.goto(`/sa/${locale}/checkout/payment-return`);
        const card = page.getByTestId("awj-payment-return");
        await expect(card).toBeVisible({ timeout: 30_000 });
        // wait until the first server verdict replaced the loading notice
        if (name !== "pending") await expect(card.locator("h1")).not.toHaveText(/…|\.\.\./, { timeout: 15_000 });
        await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);

        for (const button of await card.getByRole("button").all()) {
          const box = await button.boundingBox();
          expect(box?.height ?? 0, "touch target").toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: join(OUT, `${vpName}-${locale}-${name}.png`), fullPage: false });
      });
    }
  }
}

test("unknown order on this device (mobile ar)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, null);
  await page.goto("/sa/ar/checkout/payment-return");
  await expect(page.getByTestId("awj-payment-return")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: join(OUT, "mobile-ar-unknown.png") });
});

test("a provider-style query string is never believed", async ({ page }) => {
  await seed(page, "o-failed");
  await page.goto("/sa/en/checkout/payment-return?status=paid&id=x&message=Succeeded");
  const card = page.getByTestId("awj-payment-return");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator("h1")).toHaveText(/didn.t go through/i, { timeout: 15_000 });
});
