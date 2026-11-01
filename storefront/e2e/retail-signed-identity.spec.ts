import fs from "node:fs";
import path from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * B2C ACTIVATION READINESS — browser proof that independent shoppers no longer share ONE login bucket.
 *
 * Runs against the same LOCAL, throwaway stack as the retail-accounts journey (`scripts/e2e/retail-accounts-stack.sh up`), booted
 * twice by the caller: once with the signed-identity feature OFF (the shipped default) and once ON
 * (`STOREFRONT_SIGNED_CLIENT_IP_ENABLED=true` for Laravel, `STOREFRONT_CLIENT_IP_SOURCE=real-ip` for the storefront):
 *
 *   E2E_SIGNED_IDENTITY=off|on pnpm exec playwright test --config=playwright.signed-identity-e2e.config.ts
 *
 * Each "shopper" is its own browser context presenting its own `x-real-ip` to the storefront server (the stand-in for a trusted
 * edge). Failed sign-ins use a different e-mail every time so only the NETWORK dimension of the limiter is exercised; the
 * per-address brake is covered by the PHP suite. Refuses non-loopback API URLs.
 */
const MODE = process.env.E2E_SIGNED_IDENTITY === "on" ? "on" : "off";
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const STORE = process.env.E2E_STORE_PORT ?? "3001";
const SEED = JSON.parse(
  fs.readFileSync(
    process.env.E2E_SEED_JSON ?? "/tmp/e2e-retail/seed.json",
    "utf8",
  ),
) as { hosts: { shop: string } };
const SHOP = `http://${SEED.hosts.shop}:${STORE}`;
const THROTTLED = /too many attempts/i;

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) {
  throw new Error(
    `Refusing to run: E2E_API_URL must be loopback (got ${API}).`,
  );
}

const evidence: Record<string, unknown> = { mode: MODE };

/**
 * One failed sign-in on the (already open) form. The form is reused between attempts so a whole burst fits inside the limiter's
 * one-minute window (re-navigating each time takes ~3 s and would let the window roll over before the 20th attempt).
 */
async function attempt(page: Page, n: number): Promise<boolean> {
  if (!page.url().startsWith(SHOP)) {
    await page.goto(`${SHOP}/sa/en/account`, { waitUntil: "domcontentloaded" });
  }
  await page.locator("#email").fill(`probe-${Date.now()}-${n}@e2e.test`);
  await page.locator("#current-password").fill("Wrong-password-1");
  const done = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().startsWith(SHOP),
  );
  await page.locator("main button[type=submit]").click();
  await done;
  const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(alert).toBeVisible();
  const text = (await alert.innerText()) ?? "";
  evidence.lastAlertText = text;
  return THROTTLED.test(text);
}

async function shopper(browser: Browser, headers: Record<string, string>) {
  const context = await browser.newContext({
    extraHTTPHeaders: headers,
    locale: "en-US",
  });
  return { context, page: await context.newPage() };
}

test.afterAll(() => {
  const dir = path.resolve("test-results/signed-identity-e2e");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `evidence-${MODE}.json`),
    JSON.stringify(evidence, null, 2),
  );
});

test(`independent shoppers vs one abusive shopper (signed identity ${MODE})`, async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // Shopper A hammers sign-in until throttled (the per-visitor / per-store login limit is 20 per minute).
  const a = await shopper(browser, { "x-real-ip": "34.120.1.10" });
  let aThrottledAt = 0;
  for (let i = 1; i <= 25 && !aThrottledAt; i++) {
    if (await attempt(a.page, i)) aThrottledAt = i;
  }
  evidence.shopperA_throttled_at_attempt = aThrottledAt;
  expect(
    aThrottledAt,
    "the abusive shopper must still be throttled",
  ).toBeGreaterThan(0);
  expect(aThrottledAt).toBeLessThanOrEqual(22);

  // Shopper B is a different person on a different network, arriving right after.
  const b = await shopper(browser, { "x-real-ip": "34.120.9.20" });
  const bThrottled = await attempt(b.page, 1);
  evidence.shopperB_throttled = bThrottled;

  // Shopper C only FORGES forwarding headers (a different one every attempt, no trusted source): it must never earn a bucket of
  // its own, so it is limited like any anonymous caller of the shared legacy bucket (immediately, in "off" mode, because A
  // already filled that bucket; after ~20 attempts, in "on" mode, because A used its own visitor bucket instead).
  const c = await shopper(browser, {});
  let cThrottledAt = 0;
  for (let i = 1; i <= 25 && !cThrottledAt; i++) {
    await c.context.setExtraHTTPHeaders({
      "x-forwarded-for": `34.120.7.${i}`,
      "x-client-ip": `34.120.8.${i}`,
      "x-storefront-client-ip": `34.120.6.${i}`,
    });
    if (await attempt(c.page, i)) cThrottledAt = i;
  }
  evidence.forgedHeadersShopper_throttled_at_attempt = cThrottledAt;

  if (MODE === "on") {
    expect(
      bThrottled,
      "an independent shopper must not be locked out by A",
    ).toBe(false);
    expect(
      cThrottledAt,
      "forged headers must not earn fresh buckets",
    ).toBeGreaterThan(15);
    expect(cThrottledAt).toBeLessThanOrEqual(22);
  } else {
    expect(
      bThrottled,
      "legacy: one shared store-wide bucket locks B out too",
    ).toBe(true);
    expect(cThrottledAt).toBe(1);
  }

  for (const s of [a, b, c]) await s.context.close();
});
