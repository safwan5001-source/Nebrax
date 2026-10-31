import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * H6 Batch L — native wholesale buyer journey, verified in a REAL browser against a REAL Laravel API.
 *
 * Boot the stack with `scripts/e2e/wholesale-stack.sh` first. Everything here targets loopback only
 * (the guard below refuses any other API/store URL) and a throwaway SQLite database seeded by
 * `e2e/support/wholesale-e2e-seed.php`. Nothing is mocked: the buyer's session, price precedence,
 * cart, checkout and order all go through the production code paths.
 *
 * Two deliberate harness accommodations (both reported, neither weakens a security gate):
 *  1. `resetBuckets()` clears the file cache before each user action. The anonymous `store/v1` limiter is
 *     30 requests/minute per connection IP and every visitor arrives from the one storefront-server IP, so
 *     a single browser cannot complete the journey without it (see the report, blocker B1).
 *  2. Email delivery is the app's own `log` mail transport; the confirmation link is read from that log.
 *     Session expiry is simulated by back-dating the token in the throwaway DB (a browser test cannot wait out the TTL).
 */

const ENV = {
  api: process.env.E2E_API_URL ?? "http://127.0.0.1:8000",
  store: process.env.E2E_STORE_PORT ?? "3001",
  secret:
    process.env.E2E_GATEWAY_SECRET ??
    "e2e-local-gateway-secret-not-a-real-secret",
  seedJson: process.env.E2E_SEED_JSON ?? "/tmp/e2e-wholesale/seed.json",
  laravelRoot: process.env.E2E_LARAVEL_ROOT ?? "",
  dbPath: process.env.E2E_DB_PATH ?? "/tmp/e2e-wholesale/e2e.sqlite",
  evidenceDir: path.resolve("test-results/wholesale-e2e"),
};
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
if (!LOOPBACK.test(ENV.api)) {
  throw new Error(
    `Refusing to run: E2E_API_URL must be loopback (got ${ENV.api}).`,
  );
}
if (!ENV.laravelRoot) {
  throw new Error(
    "Set E2E_LARAVEL_ROOT to the assembled Laravel app (see scripts/e2e/wholesale-stack.sh).",
  );
}
if (!ENV.dbPath.includes("e2e")) {
  throw new Error(
    "Refusing to run: E2E_DB_PATH must be a throwaway path containing 'e2e'.",
  );
}

type Seed = {
  password: string;
  hosts: { ws: string; ws2: string; dtc: string; other_tenant: string };
  seeded_buyers: Record<string, { email: string }>;
  staff: { email: string };
  channel_ids: { ws: string; ws2: string; dtc: string };
  products: { p1: string; p2: string; p3: string; retail: string };
};
const seed: Seed = JSON.parse(fs.readFileSync(ENV.seedJson, "utf8"));
const msg = (locale: string) =>
  JSON.parse(fs.readFileSync(path.resolve(`messages/${locale}.json`), "utf8"));
const en = msg("en");
const ar = msg("ar");

const base = (host: string) => `http://${host}:${ENV.store}`;
const WS = base(seed.hosts.ws);
const DTC = base(seed.hosts.dtc);

// ───────────────────────── evidence (sanitized: no tokens, emails, secrets) ─────────────────────────
const evidence: Array<Record<string, unknown>> = [];
const ev = (id: string, data: Record<string, unknown>) =>
  evidence.push({ id, at: new Date().toISOString(), ...data });
test.afterAll(() => {
  fs.mkdirSync(ENV.evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(ENV.evidenceDir, `evidence-${test.info().project.name}.json`),
    JSON.stringify(evidence, null, 2),
  );
});

// ───────────────────────── helpers ─────────────────────────
const resetBuckets = () => {
  // Laravel may write a cache file mid-removal: retry instead of failing the step.
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(path.join(ENV.laravelRoot, "storage/framework/cache/data"), {
        recursive: true,
        force: true,
      });
      return;
    } catch {
      /* ENOTEMPTY race */
    }
  }
};
const go = async (page: Page, url: string) => {
  resetBuckets();
  await page.goto(url, { waitUntil: "domcontentloaded" });
};
const click = async (page: Page, locator: ReturnType<Page["getByRole"]>) => {
  resetBuckets();
  await locator.click();
};
/** Arabic-Indic digits / separators → Latin, so `٧٫٠٠ ر.س.` matches `7.00`. */
const latin = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[‎‏]/g, "");
const bodyText = async (page: Page) => {
  // Next streams dynamic parts after domcontentloaded: wait until the page has real content before reading it.
  await page
    .waitForFunction(
      () => document.body.innerText.trim().length > 40,
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
  return latin(await page.locator("body").innerText());
};
const pricesOn = (page: Page, re: RegExp) =>
  expect.poll(() => bodyText(page), { timeout: 20_000 }).toMatch(re);
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: path.join(
      ENV.evidenceDir,
      "screenshots",
      `${test.info().project.name}-${name}.png`,
    ),
    fullPage: true,
  });

const php = (script: string, args: string[] = []) =>
  JSON.parse(
    execFileSync("php", [path.resolve(`e2e/support/${script}`), ...args], {
      cwd: ENV.laravelRoot,
      env: {
        ...process.env,
        E2E_ALLOW_SEED: "1",
        DB_CONNECTION: "sqlite",
        DB_DATABASE: ENV.dbPath,
      },
      encoding: "utf8",
    }),
  );

/** Last confirmation link addressed to `email`, read from the app's own `log` mail transport. */
function verificationLink(email: string): URL {
  const log = fs.readFileSync(
    path.join(ENV.laravelRoot, "storage/logs/laravel.log"),
    "utf8",
  );
  const blocks = log
    .split(/\nTo: /)
    .slice(1)
    .filter((b) => b.startsWith(email));
  const last = blocks.at(-1) ?? "";
  const m = last.match(
    /https?:\/\/[^"'\s<]+\/buyer\/verify\?token=[A-Za-z0-9]+/,
  );
  if (!m) throw new Error("no verification link was mailed to the buyer");
  return new URL(m[0]);
}

type GwOpts = {
  token?: string;
  cart?: string;
  body?: unknown;
  idem?: string;
  secret?: string | null;
  headers?: Record<string, string>;
  forwardHost?: boolean;
};
/** What the storefront server does: forwarded host + gateway secret (+ buyer token, cart cookie). */
async function gw(host: string, method: string, p: string, o: GwOpts = {}) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(o.forwardHost === false ? {} : { "X-Storefront-Forwarded-Host": host }),
    ...(o.secret === null
      ? {}
      : { "X-Storefront-Gateway-Secret": o.secret ?? ENV.secret }),
    ...(o.token ? { "X-Customer-Token": o.token } : {}),
    ...(o.cart ? { Cookie: `awj_cart_token=${o.cart}` } : {}),
    ...(o.idem ? { "Idempotency-Key": o.idem } : {}),
    ...(o.headers ?? {}),
  };
  const res = await fetch(`${ENV.api}/store/v1/${p}`, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, json, setCookie };
}
const cartCookie = (r: { setCookie: string[] }) =>
  r.setCookie
    .map((c) => c.match(/awj_cart_token=([^;]+)/)?.[1])
    .find(Boolean) as string;

async function login(host: string, email: string, password = seed.password) {
  resetBuckets();
  const r = await gw(host, "POST", "auth/login", { body: { email, password } });
  return { status: r.status, token: r.json?.data?.token as string | undefined };
}

// staff (ERP) API — the operator who approves memberships. Token kept in memory only.
async function staffToken(): Promise<string> {
  const r = await fetch(`${ENV.api}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: seed.staff.email, password: seed.password }),
  });
  expect(r.status).toBe(200);
  return (await r.json()).token;
}
async function staffTransition(
  email: string,
  action: "approve" | "suspend" | "reinstate",
) {
  const t = await staffToken();
  const h = {
    Authorization: `Bearer ${t}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const list = await (
    await fetch(
      `${ENV.api}/api/commerce/wholesale/channels/${seed.channel_ids.ws}/memberships?per_page=100`,
      { headers: h },
    )
  ).json();
  const m = list.data.find((x: any) => x.customer.email === email);
  expect(m, "membership visible to staff").toBeTruthy();
  const res = await fetch(
    `${ENV.api}/api/commerce/wholesale/memberships/${m.id}/${action}`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({}),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()).data.status as string;
}

async function signIn(page: Page, email: string, locale = "en") {
  await go(page, `${WS}/sa/${locale}/buyer/sign-in`);
  await page
    .getByLabel(
      locale === "ar"
        ? ar.wholesaleBuyer.signIn.email
        : en.wholesaleBuyer.signIn.email,
    )
    .fill(email);
  await page
    .getByLabel(
      locale === "ar"
        ? ar.wholesaleBuyer.signIn.password
        : en.wholesaleBuyer.signIn.password,
      { exact: true },
    )
    .first()
    .fill(seed.password);
  resetBuckets();
  await page
    .getByRole("button", {
      name: locale === "ar" ? ar.wholesaleBuyer.signIn.submit : /^sign in$/i,
    })
    .click();
  await page.waitForURL(/\/buyer\/membership/);
}

// ═════════════════════════════════════════════════════════════════
//  A. THE BUYER JOURNEY (one browser context, serial)
// ═════════════════════════════════════════════════════════════════
test.describe
  .serial("@desktop wholesale buyer journey", () => {
    let ctx: BrowserContext;
    let page: Page;
    const email = `journey-${Date.now().toString(36)}@e2e.test`;
    let sessionCookieValue = "";
    let applyMs = 0;
    const requestedUrls: string[] = [];

    test.beforeAll(async ({ browser }) => {
      ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      page = await ctx.newPage();
      page.on("request", (r) => requestedUrls.push(r.url()));
    });
    test.afterAll(async () => ctx.close());

    test("01 anonymous visitor gets the sign-in gate, not the catalogue", async () => {
      await go(page, `${WS}/sa/en/products`);
      await expect(
        page.getByText(en.wholesaleBuyer.gate.sign_in_required.title).first(),
      ).toBeVisible();
      const text = await bodyText(page);
      expect(text).not.toContain("صنف جملة");
      expect(text).not.toMatch(/\d+\.00/);
      await shot(page, "01-anonymous-gate");
      ev("01", { result: "gate shown; no product names or prices rendered" });
    });

    test("02 buyer registers; response is neutral and asks to check email", async () => {
      await go(page, `${WS}/sa/en/buyer/register`);
      await page
        .getByLabel(en.wholesaleBuyer.register.displayName)
        .fill("Journey Buyer Co");
      await page.getByLabel(en.wholesaleBuyer.signIn.email).fill(email);
      await page
        .getByLabel(en.wholesaleBuyer.signIn.password, { exact: true })
        .first()
        .fill(seed.password);
      await click(
        page,
        page.getByRole("button", { name: en.wholesaleBuyer.register.submit }),
      );
      await expect(
        page.getByText(en.wholesaleBuyer.register.doneTitle),
      ).toBeVisible();
      await shot(page, "02-register-done");
      ev("02", { result: "neutral done state shown" });
    });

    test("03 sign-in is refused before the email is confirmed (indistinguishable failure)", async () => {
      await go(page, `${WS}/sa/en/buyer/sign-in`);
      await page.getByLabel(en.wholesaleBuyer.signIn.email).fill(email);
      await page
        .getByLabel(en.wholesaleBuyer.signIn.password, { exact: true })
        .first()
        .fill(seed.password);
      await click(page, page.getByRole("button", { name: /^sign in$/i }));
      await expect(
        page.getByText(en.wholesaleBuyer.errors.invalidCredentials),
      ).toBeVisible();
      expect(
        (await ctx.cookies()).some((c) => c.name === "awj_buyer_session"),
      ).toBe(false);
      ev("03", {
        result: "refused with the generic message; no session cookie set",
      });
    });

    test("04 confirmation mail goes to the channel host; the link confirms once only", async () => {
      const link = verificationLink(email);
      expect(link.hostname).toBe(seed.hosts.ws);
      expect(link.pathname).toMatch(/\/buyer\/verify$/);
      const local = `${WS}${link.pathname}${link.search}`;
      await go(page, local);
      await click(
        page,
        page.getByRole("button", { name: en.wholesaleBuyer.verify.confirm }),
      );
      await expect(
        page.getByText(en.wholesaleBuyer.verify.successTitle),
      ).toBeVisible();
      await shot(page, "04-verified");
      // replay of the same link
      await go(page, local);
      await click(
        page,
        page.getByRole("button", { name: en.wholesaleBuyer.verify.confirm }),
      );
      await expect(
        page.getByText(en.wholesaleBuyer.verify.failedTitle),
      ).toBeVisible();
      ev("04", {
        mail_link_host_matches_channel: true,
        link_scheme_in_mail: link.protocol,
        mail_link_path_shape: link.pathname.replace(
          /[A-Za-z0-9]{30,}/g,
          "{token}",
        ),
        replay: "refused with the generic failed state",
      });
    });

    test("05 sign-in sets an HttpOnly session cookie and leaks the token nowhere in the browser", async () => {
      await signIn(page, email);
      const cookies = await ctx.cookies();
      const c = cookies.find((x) => x.name === "awj_buyer_session");
      expect(c, "buyer session cookie").toBeTruthy();
      sessionCookieValue = c!.value;
      expect(c!.httpOnly).toBe(true);
      expect(c!.sameSite).toBe("Lax");
      expect(c!.domain.startsWith(".")).toBe(false); // host-only
      expect(c!.secure).toBe(true);
      // not readable by page script
      expect(await page.evaluate(() => document.cookie)).not.toContain(
        "awj_buyer_session",
      );
      // not in web storage
      const storage = await page.evaluate(() =>
        JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }),
      );
      expect(storage).not.toContain(sessionCookieValue);
      // not in any URL the browser requested, nor in the DOM
      expect(requestedUrls.some((u) => u.includes(sessionCookieValue))).toBe(
        false,
      );
      expect(await page.content()).not.toContain(sessionCookieValue);
      await shot(page, "05-membership-after-signin");
      ev("05", {
        cookie: {
          httpOnly: c!.httpOnly,
          secure: c!.secure,
          sameSite: c!.sameSite,
          hostOnly: !c!.domain.startsWith("."),
          value: "[redacted]",
        },
        token_in_document_cookie: false,
        token_in_web_storage: false,
        token_in_requested_urls: false,
        token_in_dom: false,
      });
    });

    test("06 membership starts without an application; catalogue and cart stay gated; apply → pending", async () => {
      await expect(
        page.getByText(en.wholesaleBuyer.status.no_application.label),
      ).toBeVisible();
      await go(page, `${WS}/sa/en/products`);
      await expect(
        page.getByText(en.wholesaleBuyer.gate.approval_required.title).first(),
      ).toBeVisible();
      await go(page, `${WS}/sa/en/buyer/membership`);
      const t0 = Date.now();
      await click(
        page,
        page.getByRole("button", { name: en.wholesaleBuyer.membership.apply }),
      );
      await expect(
        page.getByText(en.wholesaleBuyer.status.pending.label).first(),
      ).toBeVisible({ timeout: 45_000 });
      applyMs = Date.now() - t0;
      await go(page, `${WS}/sa/en/products`);
      await expect(
        page.getByText(en.wholesaleBuyer.gate.approval_required.title).first(),
      ).toBeVisible();
      await shot(page, "06-pending-gated");
      ev("06", {
        result:
          "no application → catalogue gated (403 UX); applied → pending, still gated",
        apply_click_to_pending_ms: applyMs,
      });
    });

    test("07 staff approves; the buyer's next load shows Approved", async () => {
      const status = await staffTransition(email, "approve");
      expect(status).toBe("approved");
      await go(page, `${WS}/sa/en/buyer/membership`);
      await expect(
        page.getByText(en.wholesaleBuyer.status.approved.label).first(),
      ).toBeVisible();
      await shot(page, "07-approved");
      ev("07", {
        staff_action:
          "approve via /api/commerce/wholesale/memberships/{id}/approve",
        resulting_status: status,
      });
    });

    test("08 listing: channel price shown, unpriced product marked unavailable with no add button", async () => {
      await go(page, `${WS}/sa/en/products`);
      await expect(page.getByText("صنف جملة أول")).toBeVisible();
      await pricesOn(page, /7\.00/); // P1 channel list (700 minor) — this buyer is not partner-linked
      await pricesOn(page, /9\.00/); // P2 channel list
      expect(await bodyText(page)).not.toMatch(/10\.00/); // never the retail 1000
      await expect(
        page.getByText(en.products.wholesaleUnavailable),
      ).toBeVisible();
      // the smallest element that holds both the product name and the unavailable notice is its card
      const card = page
        .getByText("صنف بلا سعر جملة")
        .first()
        .locator(
          "xpath=ancestor::*[.//text()[contains(., 'Not available for wholesale')]][1]",
        );
      await expect(
        card.getByRole("button", { name: /add to cart/i }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /add to cart/i }),
      ).toHaveCount(2); // P1 and P2 only
      await shot(page, "08-listing");
      ev("08", {
        p1: "7.00 (channel list)",
        p2: "9.00 (channel list)",
        p3: "unavailable, no add-to-cart",
        retail_1000_seen: false,
      });
    });

    test("09 product page: price and the unavailable state", async () => {
      await go(page, `${WS}/sa/en/products`);
      resetBuckets();
      await page
        .getByRole("link", { name: /صنف جملة أول/ })
        .first()
        .click();
      await page.waitForURL(/\/products\//);
      await pricesOn(page, /7\.00/);
      await shot(page, "09-detail-p1");
      await go(page, `${WS}/sa/en/products`);
      resetBuckets();
      await page
        .getByRole("link", { name: /صنف بلا سعر جملة/ })
        .first()
        .click();
      await page.waitForURL(/\/products\//);
      await expect(
        page.getByText(en.products.wholesaleUnavailable).first(),
      ).toBeVisible();
      await shot(page, "09-detail-p3-unavailable");
      ev("09", {
        p1_detail_price: "7.00",
        p3_detail: "unavailable state shown",
      });
    });

    test("10 cart: add, update, refresh-recovery, remove, re-add", async () => {
      await go(page, `${WS}/sa/en/products`);
      await click(
        page,
        page.getByRole("button", { name: /add to cart/i }).first(),
      );
      await page.waitForTimeout(1500);
      await go(page, `${WS}/sa/en/cart`);
      await pricesOn(page, /7\.00/);
      await click(
        page,
        page
          .getByRole("button", {
            name: en.cart.increaseQuantity ?? "Increase quantity",
          })
          .first(),
      );
      await expect
        .poll(async () => bodyText(page), { timeout: 15_000 })
        .toMatch(/14\.00/);
      // refresh recovery
      await go(page, `${WS}/sa/en/cart`);
      await pricesOn(page, /14\.00/);
      await shot(page, "10-cart-qty2-after-refresh");
      // remove
      await click(page, page.getByRole("button", { name: /remove/i }).first());
      await expect(page.getByText(en.cart.emptyCart)).toBeVisible({
        timeout: 15_000,
      });
      // re-add P1 and P2 (qty 1 each)
      await go(page, `${WS}/sa/en/products`);
      const adds = page.getByRole("button", { name: /add to cart/i });
      await click(page, adds.first());
      await page.waitForTimeout(1500);
      await go(page, `${WS}/sa/en/products`);
      await click(
        page,
        page.getByRole("button", { name: /add to cart/i }).last(),
      );
      await page.waitForTimeout(1500);
      await go(page, `${WS}/sa/en/cart`);
      await expect
        .poll(async () => bodyText(page), { timeout: 15_000 })
        .toMatch(/16\.00/);
      await shot(page, "10-cart-two-lines");
      ev("10", {
        add: "7.00",
        update: "qty 2 → 14.00",
        refresh: "persisted 14.00",
        remove: "empty state",
        re_add: "P1 + P2 → subtotal 16.00",
      });
    });

    test("11 cart follows the buyer to a brand-new browser context (buyer-owned cart)", async ({
      browser,
    }) => {
      const ctx2 = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const p2 = await ctx2.newPage();
      await signIn(p2, email);
      await go(p2, `${WS}/sa/en/cart`);
      await pricesOn(p2, /16\.00/);
      await ctx2.close();
      ev("11", { result: "fresh context, signed in, same cart (16.00)" });
    });

    test("12 checkout end to end with the native non-capturing path; double submit yields ONE order", async () => {
      await go(page, `${WS}/sa/en/checkout`);
      await page.getByLabel("Full name").fill("Journey Buyer");
      await page.getByLabel("Phone number").fill("0501234567");
      await click(
        page,
        page.getByRole("button", { name: /continue to address/i }),
      );
      await page.getByLabel("Region").waitFor();
      for (const [l, v] of [
        ["Country", "SA"],
        ["Region", "Eastern"],
        ["City", "الدمام"],
        ["District", "الشاطئ"],
        ["Street", "الملك فهد"],
        ["Postal code", "31411"],
      ] as const) {
        await page.getByLabel(l).first().fill(v);
      }
      await click(
        page,
        page.getByRole("button", { name: /continue to delivery/i }),
      );
      await page.getByText("Pickup", { exact: true }).click();
      await click(
        page,
        page.getByRole("button", { name: /continue to payment/i }),
      );
      await expect(
        page.getByText(/hasn't enabled a specific payment method/i).first(),
      ).toBeVisible();
      await shot(page, "12-payment-stage-no-capture");
      await click(
        page,
        page.getByRole("button", { name: /continue to review/i }),
      );
      const complete = page.getByRole("button", { name: /complete order/i });
      await expect(complete).toBeVisible();
      await shot(page, "12-review");
      resetBuckets();
      // duplicate submission: two rapid clicks
      await Promise.allSettled([
        complete.click({ timeout: 5000 }),
        complete.click({ timeout: 5000, force: true }),
      ]);
      await page
        .waitForURL(/(confirmation|order|thank)/i, { timeout: 30_000 })
        .catch(() => undefined);
      await page.waitForTimeout(2000);
      await shot(page, "12-confirmation");
      ev("12", {
        url_after_complete: new URL(page.url()).pathname.replace(
          /[0-9a-f-]{20,}/g,
          "{id}",
        ),
        confirmation_text_snippet: (await bodyText(page)).slice(0, 160),
      });
    });

    test("13 exactly one order, owned by this buyer on this channel, with price provenance; nothing financial was touched", async () => {
      const out = php("wholesale-e2e-evidence.php", [email]);
      expect(out.order_count).toBe(1);
      const o = out.orders[0];
      expect(o.owned_by_expected_identity).toBe(true);
      expect(o.channel_id).toBe(seed.channel_ids.ws);
      expect(
        o.lines.map((l: any) => [l.quantity, l.unit_price_minor]).sort(),
      ).toEqual([
        [1, 700],
        [1, 900],
      ]);
      expect(
        o.lines.every(
          (l: any) => l.price_source === "price_list" && l.price_list_id,
        ),
      ).toBe(true);
      // A CommercePaymentIntent is the order's own non-accounting payment record (≠ AWJ Payment); it must be non-capturing.
      const { commerce_payment_intents: intents, ...financial } =
        out.untouched as Record<string, number>;
      for (const [k, v] of Object.entries(financial))
        expect(v, `untouched.${k}`).toBe(0);
      expect(intents).toBe(out.order_count); // one intent per order, nothing more
      for (const i of out.payment_intents) {
        expect(["pay_on_pickup", "cod"]).toContain(i.method);
        expect(["awaiting_collection", "awaiting_payment"]).toContain(i.status);
      }
      ev("13", {
        order_count: out.order_count,
        owned_by_expected_identity: true,
        channel: "wholesale (ws)",
        lines: o.lines.map((l: any) => ({
          qty: l.quantity,
          unit_minor: l.unit_price_minor,
          price_source: l.price_source,
        })),
        total_minor: o.total_minor,
        untouched_financial_tables: financial,
        payment_intent_records: out.payment_intents,
      });
    });

    test("14 suspension: gated again, cart/checkout refused; reinstatement restores access", async () => {
      expect(await staffTransition(email, "suspend")).toBe("suspended");
      await go(page, `${WS}/sa/en/products`);
      await expect(
        page.getByText(en.wholesaleBuyer.gate.approval_required.title).first(),
      ).toBeVisible();
      await go(page, `${WS}/sa/en/cart`);
      expect(await bodyText(page)).not.toMatch(/\d+\.00/);
      await shot(page, "14-suspended-cart");
      await go(page, `${WS}/sa/en/buyer/membership`);
      await expect(
        page.getByText(en.wholesaleBuyer.status.suspended.label).first(),
      ).toBeVisible();
      expect(await staffTransition(email, "reinstate")).toBe("approved");
      await go(page, `${WS}/sa/en/products`);
      await expect(page.getByText("صنف جملة أول")).toBeVisible();
      ev("14", {
        suspended:
          "catalogue gated, cart priceless, membership shows Suspended",
        reinstated: "catalogue visible again",
      });
    });

    test("15 sign-out revokes the session server-side; the old token is dead; expiry also refused", async () => {
      resetBuckets();
      const tokenBefore = sessionCookieValue; // stored value is the Sanctum token the Next server forwards
      await go(page, `${WS}/sa/en/buyer/membership`);
      await click(
        page,
        page.getByRole("button", {
          name: en.wholesaleBuyer.membership.signOut,
        }),
      );
      await page.waitForTimeout(1500);
      expect(
        (await ctx.cookies()).some((c) => c.name === "awj_buyer_session"),
      ).toBe(false);
      resetBuckets();
      const replay = await gw(seed.hosts.ws, "GET", "cart", {
        token: tokenBefore,
      });
      expect([401, 403]).toContain(replay.status);
      // expiry: sign in again, back-date, observe the gate
      await signIn(page, email);
      php("wholesale-e2e-expire-session.php", [email]);
      await go(page, `${WS}/sa/en/products`);
      await expect(
        page.getByText(en.wholesaleBuyer.gate.sign_in_required.title).first(),
      ).toBeVisible();
      await shot(page, "15-expired-session-gate");
      ev("15", {
        logout_cookie_cleared: true,
        replayed_revoked_token_status: replay.status,
        expired_session: "gate shown (sign-in required)",
      });
    });
  });

// ═════════════════════════════════════════════════════════════════
//  B. PRICE PRECEDENCE IN THE BROWSER (partner-linked buyer)
// ═════════════════════════════════════════════════════════════════
test.describe("@desktop buyer-specific price precedence", () => {
  test("linked buyer sees the partner list price (5.00) for P1 and channel fallback (9.00) for P2", async ({
    page,
  }) => {
    await signIn(page, seed.seeded_buyers.linked.email);
    await go(page, `${WS}/sa/en/products`);
    await pricesOn(page, /5\.00/);
    await pricesOn(page, /9\.00/);
    expect(await bodyText(page)).not.toMatch(/7\.00/);
    await shot(page, "B1-linked-buyer-prices");
    ev("B1", {
      p1: "5.00 (partner list)",
      p2: "9.00 (channel fallback)",
      retail_seen: false,
    });
  });
});

// ═════════════════════════════════════════════════════════════════
//  C. SECURITY PROBES (API level, exactly what the browser's server can send)
// ═════════════════════════════════════════════════════════════════
test.describe
  .serial("@desktop security", () => {
    const S = seed.seeded_buyers;
    let linked = "";
    let p1CartCookie = "";

    test("C01 cross-tenant and cross-channel tokens are refused", async () => {
      linked = (await login(seed.hosts.ws, S.linked.email)).token!;
      expect(linked).toBeTruthy();
      const tenantB = await gw(seed.hosts.other_tenant, "GET", "products", {
        token: linked,
      });
      const channel2 = await gw(seed.hosts.ws2, "GET", "products", {
        token: linked,
      });
      resetBuckets();
      const ok = await gw(seed.hosts.ws, "GET", "products", { token: linked });
      expect(ok.status).toBe(200);
      expect(tenantB.status).toBeGreaterThanOrEqual(400);
      expect(channel2.status).toBeGreaterThanOrEqual(400);
      ev("C01", {
        same_channel: ok.status,
        other_tenant_host: tenantB.status,
        other_wholesale_channel_host: channel2.status,
      });
    });

    test("C02 login on another tenant is refused; on a sibling channel it yields no access", async () => {
      const t = await login(seed.hosts.other_tenant, S.linked.email);
      expect(t.status).toBeGreaterThanOrEqual(400);
      // A buyer identity is tenant-wide (one login), membership is per channel: signing in on a sibling wholesale
      // channel is allowed by design and yields a token bound to THAT channel — which carries no access there.
      const c = await login(seed.hosts.ws2, S.linked.email);
      expect(c.status).toBe(200);
      resetBuckets();
      const products = await gw(seed.hosts.ws2, "GET", "products", {
        token: c.token,
      });
      const add = await gw(seed.hosts.ws2, "POST", "cart/items", {
        token: c.token,
        body: { product_id: seed.products.p1, quantity: 1, unit_key: "base" },
      });
      expect(products.status).toBe(403);
      expect(add.status).toBeGreaterThanOrEqual(400);
      ev("C02", {
        other_tenant_login: t.status,
        sibling_channel_login: c.status,
        sibling_channel_catalogue: products.status,
        sibling_channel_add_to_cart: add.status,
      });
    });

    test("C03 suspended buyer: can authenticate but the catalogue and cart are refused", async () => {
      const t = (await login(seed.hosts.ws, S.suspended.email)).token!;
      resetBuckets();
      const products = await gw(seed.hosts.ws, "GET", "products", { token: t });
      const cart = await gw(seed.hosts.ws, "POST", "cart/items", {
        token: t,
        body: { product_id: seed.products.p1, quantity: 1, unit_key: "base" },
      });
      expect(products.status).toBe(403);
      expect([401, 403]).toContain(cart.status);
      ev("C03", { products: products.status, add_to_cart: cart.status });
    });

    test("C04 missing token on a wholesale host is 401; garbage token is 401", async () => {
      resetBuckets();
      const none = await gw(seed.hosts.ws, "GET", "products");
      const junk = await gw(seed.hosts.ws, "GET", "products", {
        token: "1|not-a-real-token",
      });
      expect(none.status).toBe(401);
      expect(junk.status).toBe(401);
      ev("C04", { missing: none.status, malformed: junk.status });
    });

    test("C05 expired and revoked sessions are refused", async () => {
      const e = (await login(seed.hosts.ws, S.revoked_target.email)).token!;
      php("wholesale-e2e-expire-session.php", [S.revoked_target.email]);
      resetBuckets();
      const expired = await gw(seed.hosts.ws, "GET", "products", { token: e });
      expect(expired.status).toBe(401);
      const r = (await login(seed.hosts.ws, S.linked.email)).token!;
      resetBuckets();
      await gw(seed.hosts.ws, "POST", "auth/logout", { token: r });
      resetBuckets();
      const revoked = await gw(seed.hosts.ws, "GET", "products", { token: r });
      expect(revoked.status).toBe(401);
      ev("C05", {
        expired_token: expired.status,
        revoked_token_after_logout: revoked.status,
      });
    });

    test("C06 forged buyer/partner identity headers and a client-supplied buyer token header change nothing", async ({
      browser,
    }) => {
      const t = (await login(seed.hosts.ws, S.linked.email)).token!;
      resetBuckets();
      const baseline = await gw(seed.hosts.ws, "GET", "products", { token: t });
      resetBuckets();
      const forged = await gw(seed.hosts.ws, "GET", "products", {
        token: t,
        headers: {
          "X-Customer-Identity-Id": "00000000-0000-0000-0000-000000000000",
          "X-Customer-Id": "00000000-0000-0000-0000-000000000000",
          "X-Partner-Id": "00000000-0000-0000-0000-000000000000",
          "X-Price-List-Id": "00000000-0000-0000-0000-000000000000",
          "X-Tenant-Id": "00000000-0000-0000-0000-000000000000",
        },
      });
      const prices = (r: any) =>
        r.json.data
          .map((p: any) => [p.name, p.price?.amount_minor ?? p.price?.amount])
          .sort();
      expect(forged.status).toBe(200);
      expect(prices(forged)).toEqual(prices(baseline));

      // the browser itself: a client-supplied X-Customer-Token on an anonymous visit must not unlock anything
      const ctx = await browser.newContext({
        extraHTTPHeaders: {
          "X-Customer-Token": t,
          "X-Customer-Identity-Id": "forged",
        },
      });
      const pg = await ctx.newPage();
      await go(pg, `${WS}/sa/en/products`);
      await expect(
        pg.getByText(en.wholesaleBuyer.gate.sign_in_required.title).first(),
      ).toBeVisible();
      await shot(pg, "C06-forged-header-still-gated");
      await ctx.close();
      ev("C06", {
        forged_identity_headers_changed_prices: false,
        browser_supplied_token_header_unlocked_catalogue: false,
      });
    });

    test("C07 a buyer token without the gateway secret cannot mutate (no direct-to-API cart or login)", async () => {
      resetBuckets();
      const noSecret = await gw(seed.hosts.ws, "POST", "cart/items", {
        token: linked,
        secret: null,
        body: { product_id: seed.products.p1, quantity: 1, unit_key: "base" },
      });
      const wrongSecret = await gw(seed.hosts.ws, "POST", "cart/items", {
        token: linked,
        secret: "wrong",
        body: { product_id: seed.products.p1, quantity: 1, unit_key: "base" },
      });
      expect(noSecret.status).toBeGreaterThanOrEqual(400);
      expect(wrongSecret.status).toBeGreaterThanOrEqual(400);
      ev("C07", {
        no_secret: noSecret.status,
        wrong_secret: wrongSecret.status,
      });
    });

    test("C08 price manipulation is rejected outright; the honest add is priced by the server; an unpriced product cannot be added", async () => {
      const injected: Record<string, unknown>[] = [
        { unit_price: 1 },
        { price: 1, price_minor: 1 },
        { price_list_id: "x" },
        { partner_id: "x" },
      ];
      const rejected: number[] = [];
      for (const extra of injected) {
        resetBuckets();
        const r = await gw(seed.hosts.ws, "POST", "cart/items", {
          token: linked,
          body: {
            product_id: seed.products.p1,
            quantity: 1,
            unit_key: "base",
            ...extra,
          },
        });
        rejected.push(r.status);
        expect(r.status).toBe(422);
      }
      resetBuckets();
      const add = await gw(seed.hosts.ws, "POST", "cart/items", {
        token: linked,
        body: { product_id: seed.products.p1, quantity: 1, unit_key: "base" },
      });
      expect([200, 201]).toContain(add.status);
      p1CartCookie = cartCookie(add);
      expect(add.json.data.items).toHaveLength(1); // none of the rejected attempts left a line behind
      const unit = add.json.data.items[0].unit_price.amount_minor;
      expect(unit).toBe(500); // partner list, never the injected 1
      resetBuckets();
      const p3 = await gw(seed.hosts.ws, "POST", "cart/items", {
        token: linked,
        cart: p1CartCookie,
        body: { product_id: seed.products.p3, quantity: 1, unit_key: "base" },
      });
      expect(p3.status).toBe(422);
      expect(p3.json?.error?.details?.reason).toBe("unavailable_for_wholesale");
      ev("C08", {
        injected_price_fields_status: rejected,
        lines_after_rejections: 1,
        honest_add_unit_minor: unit,
        unpriced_product: {
          status: p3.status,
          reason: p3.json?.error?.details?.reason,
        },
      });
    });

    test("C09 a cart cookie from one channel is useless on another channel", async () => {
      resetBuckets();
      const other = await gw(seed.hosts.ws2, "GET", "cart", {
        token: linked,
        cart: p1CartCookie,
      });
      expect(other.status).toBeGreaterThanOrEqual(400);
      const dtc = await gw(seed.hosts.dtc, "GET", "cart", {
        cart: p1CartCookie,
      });
      expect(JSON.stringify(dtc.json ?? {})).not.toContain(seed.products.p1);
      ev("C09", {
        wholesale_cart_on_other_wholesale_channel: other.status,
        wholesale_cart_on_retail_channel: dtc.status,
        cart_contents_leaked: false,
      });
    });

    test("C10 duplicate checkout submission with one idempotency key yields one order; another buyer cannot read it", async () => {
      resetBuckets();
      expect(
        (
          await gw(seed.hosts.ws, "POST", "checkout", {
            token: linked,
            cart: p1CartCookie,
          })
        ).status,
      ).toBe(201);
      for (const [m, p, b] of [
        [
          "PATCH",
          "checkout/contact",
          { name: "سالم", phone: "0501234567", email: "s@example.com" },
        ],
        [
          "PATCH",
          "checkout/address",
          {
            country: "SA",
            city: "الدمام",
            district: "الشاطئ",
            street: "الملك فهد",
            postal_code: "31411",
          },
        ],
        ["PATCH", "checkout/delivery", { method: "pickup" }],
      ] as const) {
        resetBuckets();
        expect(
          (
            await gw(seed.hosts.ws, m, p, {
              token: linked,
              cart: p1CartCookie,
              body: b,
            })
          ).status,
        ).toBe(200);
      }
      resetBuckets();
      const a = await gw(seed.hosts.ws, "POST", "checkout/complete", {
        token: linked,
        cart: p1CartCookie,
        idem: "e2e-dup-1",
      });
      resetBuckets();
      const b = await gw(seed.hosts.ws, "POST", "checkout/complete", {
        token: linked,
        cart: p1CartCookie,
        idem: "e2e-dup-1",
      });
      expect(a.status).toBe(201);
      expect([200, 201]).toContain(b.status);
      const out = php("wholesale-e2e-evidence.php", [S.linked.email]);
      const mine = out.orders.filter(
        (o: any) => o.owned_by_expected_identity === true,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].lines[0].unit_price_minor).toBe(500);
      expect(mine[0].lines[0].price_source).toBe("price_list");

      // buyer B (not the owner) cannot read order A's payment state
      const other = (await login(seed.hosts.ws, S.approved_unlinked.email))
        .token!;
      resetBuckets();
      const peek = await gw(
        seed.hosts.ws,
        "GET",
        `orders/${mine[0].id}/payment-status`,
        { token: other },
      );
      expect(peek.status).toBe(404);
      ev("C10", {
        first_complete: a.status,
        replay_same_key: b.status,
        orders_for_buyer: mine.length,
        line_unit_minor: mine[0].lines[0].unit_price_minor,
        other_buyer_reads_order_status: peek.status,
      });
    });

    test("C11 login rate limiting stays fail-closed; rotating X-Forwarded-For does not reset it", async () => {
      resetBuckets();
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const r = await gw(seed.hosts.ws, "POST", "auth/login", {
          headers: { "X-Forwarded-For": `203.0.113.${i + 1}` },
          body: {
            email: S.approved_unlinked.email,
            password: "wrong-password-1",
          },
        });
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
      resetBuckets();
      ev("C11", {
        statuses_in_order: statuses,
        throttled_after: statuses.indexOf(429) + 1,
        rotating_forwarded_for_effect: "none (still throttled)",
      });
    });
  });

// ═════════════════════════════════════════════════════════════════
//  D. DTC (RETAIL) REGRESSION SMOKE
// ═════════════════════════════════════════════════════════════════
test.describe
  .serial("@desktop retail (DTC) regression smoke", () => {
    test("D01 anonymous retail browsing: no gate, retail prices, no buyer cookie", async ({
      page,
      context,
    }) => {
      await go(page, `${DTC}/sa/en/products`);
      await expect(page.getByText("صنف تجزئة").first()).toBeVisible();
      await pricesOn(page, /10\.00/);
      expect(await bodyText(page)).not.toContain(
        en.wholesaleBuyer.gate.sign_in_required.title,
      );
      expect(
        (await context.cookies()).some((c) => c.name === "awj_buyer_session"),
      ).toBe(false);
      await shot(page, "D01-retail-listing");
      ev("D01", {
        gate: false,
        retail_price_visible: "10.00",
        buyer_cookie: false,
      });
    });

    test("D02 retail cart and checkout to a confirmed order, unchanged behaviour", async ({
      page,
    }) => {
      await go(page, `${DTC}/sa/en/products`);
      await click(
        page,
        page.getByRole("button", { name: /add to cart/i }).first(),
      );
      await page.waitForTimeout(1500);
      await go(page, `${DTC}/sa/en/cart`);
      await pricesOn(page, /\d+\.00/);
      await go(page, `${DTC}/sa/en/checkout`);
      await page.getByLabel("Full name").fill("Retail Shopper");
      await page.getByLabel("Phone number").fill("0507654321");
      await click(
        page,
        page.getByRole("button", { name: /continue to address/i }),
      );
      await page.getByLabel("Region").waitFor();
      for (const [l, v] of [
        ["Country", "SA"],
        ["Region", "Eastern"],
        ["City", "الدمام"],
        ["District", "الشاطئ"],
        ["Street", "الملك فهد"],
        ["Postal code", "31411"],
      ] as const) {
        await page.getByLabel(l).first().fill(v);
      }
      await click(
        page,
        page.getByRole("button", { name: /continue to delivery/i }),
      );
      await page.getByText("Pickup", { exact: true }).click();
      await click(
        page,
        page.getByRole("button", { name: /continue to payment/i }),
      );
      await click(
        page,
        page.getByRole("button", { name: /continue to review/i }),
      );
      await click(page, page.getByRole("button", { name: /complete order/i }));
      await page.waitForTimeout(3000);
      await shot(page, "D02-retail-confirmation");
      const out = php("wholesale-e2e-evidence.php");
      const retail = out.orders.filter(
        (o: any) => o.channel_id === seed.channel_ids.dtc,
      );
      expect(retail).toHaveLength(1);
      expect(retail[0].lines[0].unit_price_minor).toBe(1000);
      expect(retail[0].lines[0].price_source).toBe("product_default"); // retail provenance, untouched by wholesale
      expect(retail[0].lines[0].price_list_id).toBeNull();
      ev("D02", {
        retail_orders: retail.length,
        unit_minor: retail[0].lines[0].unit_price_minor,
        price_source: retail[0].lines[0].price_source,
        wholesale_provenance_leaked: false,
      });
    });
  });

// ═════════════════════════════════════════════════════════════════
//  F. HARNESS-FREE CHARACTERIZATION — what a visitor sees WITHOUT the per-step bucket reset
// ═════════════════════════════════════════════════════════════════
test.describe("@desktop shared anonymous rate limit (blocker B1 — characterization, never fails)", () => {
  test("F01 repeated page loads from the storefront server exhaust the shared per-IP bucket", async ({
    page,
  }) => {
    const loop = async (url: string) => {
      resetBuckets();
      const outcomes: string[] = [];
      for (let i = 1; i <= 12; i++) {
        await page.goto(url, { waitUntil: "load" });
        await page.waitForTimeout(400);
        outcomes.push(
          (await page.getByText(/something went wrong/i).count())
            ? "error"
            : "ok",
        );
      }
      return outcomes;
    };
    const retail = await loop(`${DTC}/sa/en/products`);
    await signIn(page, seed.seeded_buyers.linked.email);
    const buyer = await loop(`${WS}/sa/en/products`);
    await shot(page, "F01-signed-in-buyer-after-repeated-loads");
    resetBuckets();
    const first = (o: string[]) => o.indexOf("error") + 1 || null;
    ev("F01", {
      limiter:
        "unauth class, 30 req/min per connection IP — every visitor of every store shares the storefront server's IP",
      anonymous_retail_12_loads: {
        outcomes: retail,
        first_failed_load: first(retail),
      },
      signed_in_wholesale_buyer_12_loads: {
        outcomes: buyer,
        first_failed_load: first(buyer),
      },
    });
  });
});

// ═════════════════════════════════════════════════════════════════
//  E. MOBILE + ARABIC / RTL
// ═════════════════════════════════════════════════════════════════
test.describe("@mobile arabic rtl on a phone viewport", () => {
  const overflow = (page: Page) =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );

  test("E01 gate, sign-in and register render RTL with no horizontal overflow", async ({
    page,
  }) => {
    for (const [name, url] of [
      ["gate", `${WS}/sa/ar/products`],
      ["sign-in", `${WS}/sa/ar/buyer/sign-in`],
      ["register", `${WS}/sa/ar/buyer/register`],
    ] as const) {
      await go(page, url);
      expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shot(page, `E01-${name}`);
    }
    await go(page, `${WS}/sa/ar/products`);
    await expect(
      page.getByText(ar.wholesaleBuyer.gate.sign_in_required.title),
    ).toBeVisible();
    ev("E01", {
      rtl: true,
      horizontal_overflow_px: 0,
      gate_title_ar_visible: true,
    });
  });

  test("E02 approved buyer on a phone: priced listing, cart and checkout form fit the viewport", async ({
    page,
  }) => {
    await signIn(page, seed.seeded_buyers.linked.email, "ar");
    await go(page, `${WS}/sa/ar/products`);
    await expect(page.getByText("صنف جملة أول")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E02-listing");
    await go(page, `${WS}/sa/ar/cart`);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E02-cart");
    await go(page, `${WS}/sa/ar/checkout`);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E02-checkout");
    ev("E02", { listing_cart_checkout_overflow_px: 0 });
  });
});
