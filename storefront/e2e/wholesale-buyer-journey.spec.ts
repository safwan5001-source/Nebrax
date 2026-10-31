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
  hosts: {
    ws: string;
    ws2: string;
    ws3: string;
    dtc: string;
    other_tenant: string;
  };
  quick_order: {
    coffee: string;
    tea: string;
    shirt: string;
    red: string;
    blue: string;
  };
  seeded_buyers: Record<string, { email: string }>;
  staff: { email: string };
  channel_ids: { ws: string; ws2: string; ws3: string; dtc: string };
  partner_id: string;
  tenant_id: string;
  products: { p1: string; p2: string; p3: string; retail: string };
};
const seed: Seed = JSON.parse(fs.readFileSync(ENV.seedJson, "utf8"));
const msg = (locale: string) =>
  JSON.parse(fs.readFileSync(path.resolve(`messages/${locale}.json`), "utf8"));
const en = msg("en");
const ar = msg("ar");

const base = (host: string) => `http://${host}:${ENV.store}`;
const WS = base(seed.hosts.ws);
const WS3 = base(seed.hosts.ws3);
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
// `E2E_NO_BUCKET_RESET=1` turns the per-step limiter reset OFF: since H6 Batch M the journey no longer needs it (the
// anonymous store/v1 budget is per storefront, not one shared per-IP bucket), and the suite is run both ways.
const resetBuckets = () => {
  if (process.env.E2E_NO_BUCKET_RESET === "1") return;
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
  // The per-tenant login brake (20/min) is shared by every buyer behind the gateway (D-T1, documented). A test run compresses
  // minutes of traffic into seconds, so a 429 is honoured like a real client would: wait out Retry-After, then retry.
  for (let attempt = 0; ; attempt++) {
    resetBuckets();
    const r = await gw(host, "POST", "auth/login", {
      body: { email, password },
    });
    if (r.status !== 429 || attempt >= 4) {
      return {
        status: r.status,
        token: r.json?.data?.token as string | undefined,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

let cachedStaffToken: string | null = null;
async function staffToken(): Promise<string> {
  // one ERP login per run: the staff login endpoint is itself throttled (5/min), which a real operator session never hits
  if (cachedStaffToken) return cachedStaffToken;
  const r = await fetch(`${ENV.api}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: seed.staff.email, password: seed.password }),
  });
  expect(r.status).toBe(200);
  cachedStaffToken = (await r.json()).token as string;
  return cachedStaffToken;
}
async function staffTransition(
  email: string,
  action: "approve" | "suspend" | "reinstate",
  channelId: string = seed.channel_ids.ws,
) {
  const t = await staffToken();
  const h = {
    Authorization: `Bearer ${t}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const list = await (
    await fetch(
      `${ENV.api}/api/commerce/wholesale/channels/${channelId}/memberships?per_page=100`,
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

async function staffHeaders() {
  return {
    Authorization: `Bearer ${await staffToken()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}
async function membershipIdOf(email: string, channelId = seed.channel_ids.ws) {
  const list = await (
    await fetch(
      `${ENV.api}/api/commerce/wholesale/channels/${channelId}/memberships?per_page=100`,
      { headers: await staffHeaders() },
    )
  ).json();
  const m = list.data.find((x: any) => x.customer.email === email);
  expect(m, "membership visible to staff").toBeTruthy();
  return {
    id: m.id as string,
    application: m.application as {
      company_name: string | null;
      contact_phone: string | null;
    },
  };
}
async function staffPartnerLink(
  membershipId: string,
  method: "PUT" | "DELETE",
) {
  const res = await fetch(
    `${ENV.api}/api/commerce/wholesale/memberships/${membershipId}/partner-link`,
    {
      method,
      headers: await staffHeaders(),
      body:
        method === "PUT"
          ? JSON.stringify({ partner_id: seed.partner_id })
          : undefined,
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()).data;
}
/** One real native order placed through the API (the same calls the storefront server makes). */
async function placeApiOrder(token: string, key: string): Promise<string> {
  resetBuckets();
  const add = await gw(seed.hosts.ws, "POST", "cart/items", {
    token,
    body: { product_id: seed.products.p1, quantity: 1, unit_key: "base" },
  });
  const cart = cartCookie(add);
  const steps: Array<[string, string, unknown]> = [
    ["POST", "checkout", undefined],
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
  ];
  for (const [m, p, body] of steps) {
    resetBuckets();
    expect([200, 201]).toContain(
      (await gw(seed.hosts.ws, m, p, { token, cart, body })).status,
    );
  }
  resetBuckets();
  const done = await gw(seed.hosts.ws, "POST", "checkout/complete", {
    token,
    cart,
    idem: key,
  });
  expect(done.status).toBe(201);
  return done.json.data.order.id as string;
}
/** Last password-reset link mailed to `email` (app's own `log` transport). */
function resetLink(email: string): URL {
  const log = fs.readFileSync(
    path.join(ENV.laravelRoot, "storage/logs/laravel.log"),
    "utf8",
  );
  const last =
    log
      .split(/\nTo: /)
      .slice(1)
      .filter((b) => b.startsWith(email))
      .at(-1) ?? "";
  const m = last.match(
    /https?:\/\/[^"'\s<]+\/buyer\/reset-password\?token=[A-Za-z0-9]+/,
  );
  if (!m) throw new Error("no password-reset link was mailed to the buyer");
  return new URL(m[0]);
}

async function signIn(
  page: Page,
  email: string,
  locale = "en",
  origin: string = WS,
) {
  const t = locale === "ar" ? ar.wholesaleBuyer : en.wholesaleBuyer;
  // Same rule as `login()`: a rate-limited sign-in (the per-tenant login brake shared behind the gateway) is waited out, as a real buyer would.
  for (let attempt = 0; ; attempt++) {
    await go(page, `${origin}/sa/${locale}/buyer/sign-in`);
    await page.getByLabel(t.signIn.email).fill(email);
    await page
      .getByLabel(t.signIn.password, { exact: true })
      .first()
      .fill(seed.password);
    resetBuckets();
    await page
      .getByRole("button", {
        name: locale === "ar" ? ar.wholesaleBuyer.signIn.submit : /^sign in$/i,
      })
      .click();
    const outcome = await Promise.race([
      page
        .waitForURL(/\/buyer\/membership/, { timeout: 20_000 })
        .then(() => "ok" as const),
      page
        .getByText(t.errors.rateLimited)
        .waitFor({ timeout: 20_000 })
        .then(() => "limited" as const),
    ]).catch(() => "timeout" as const);
    if (outcome === "ok") return;
    if (outcome !== "limited" || attempt >= 4)
      throw new Error(`sign-in did not complete (${outcome})`);
    await page.waitForTimeout(15_000);
  }
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
    let applyUiHung = false;
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
      // not applied yet: the gate says so, not "not approved"
      await expect(
        page.getByText(en.wholesaleBuyer.gate.membership.none.title).first(),
      ).toBeVisible();
      await go(page, `${WS}/sa/en/buyer/membership`);
      await page
        .getByLabel(en.wholesaleBuyer.membership.company)
        .fill("Journey Buyer Trading Co");
      await page
        .getByLabel(en.wholesaleBuyer.membership.phone)
        .fill("+966 50 123 4567");
      const t0 = Date.now();
      await click(
        page,
        page.getByRole("button", { name: en.wholesaleBuyer.membership.apply }),
      );
      const pending = page
        .getByText(en.wholesaleBuyer.status.pending.label)
        .first();
      // Observed intermittently (blocker B1): the application is recorded server-side but the button stays on
      // "Submitting…" because the post-action refresh is throttled. Record it, then confirm the real state by reloading.
      try {
        await expect(pending).toBeVisible({ timeout: 15_000 });
      } catch {
        applyUiHung = true;
        await go(page, `${WS}/sa/en/buyer/membership`);
        await expect(pending).toBeVisible({ timeout: 20_000 });
      }
      applyMs = Date.now() - t0;
      await go(page, `${WS}/sa/en/products`);
      await expect(
        page.getByText(en.wholesaleBuyer.gate.membership.pending.title).first(),
      ).toBeVisible();
      // the optional context reached the reviewer, and only as context
      const reviewed = await membershipIdOf(email);
      expect(reviewed.application).toEqual({
        company_name: "Journey Buyer Trading Co",
        contact_phone: "+966 50 123 4567",
      });
      await shot(page, "06-pending-gated");
      ev("06", {
        result:
          "no application → catalogue gated (403 UX); applied → pending, still gated",
        apply_click_to_pending_ms: applyMs,
        apply_ui_stuck_on_submitting_until_reload: applyUiHung,
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
      // by role: while the page streams, a hidden copy of the card can briefly coexist with the visible one (getByText matches both)
      await expect(
        page.getByRole("link", { name: "صنف جملة أول" }),
      ).toBeVisible();
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
      // the success state is a local stage of the checkout flow (no URL change): assert what the buyer actually sees
      await expect(
        page.getByRole("heading", { name: en.awjCheckout.success.heading }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByText(en.awjCheckout.success.notPaidNote),
      ).toBeVisible();
      const orderNo = (await bodyText(page)).match(
        /[A-Z]{2,}-\d{4}-\d{3,}/,
      )?.[0];
      expect(orderNo, "order number shown on the confirmation").toBeTruthy();
      await shot(page, "12-confirmation");
      ev("12", {
        confirmation_heading_visible: true,
        not_paid_notice_visible: true,
        order_number_shape: orderNo?.replace(/\d/g, "9"),
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

    test("13b staff links the buyer to a customer: the buyer's price changes in the browser; unlinking restores it", async () => {
      const { id } = await membershipIdOf(email);
      await go(page, `${WS}/sa/en/products`);
      await pricesOn(page, /7\.00/);

      const linked = await staffPartnerLink(id, "PUT");
      expect(linked.effective_price_list.source).toBe("partner");
      expect(linked.active.linked_by.name).toBeTruthy();
      await go(page, `${WS}/sa/en/products`);
      await pricesOn(page, /5\.00/); // partner list
      expect(await bodyText(page)).not.toMatch(/7\.00/);
      await shot(page, "13b-partner-price-after-link");

      const unlinked = await staffPartnerLink(id, "DELETE");
      expect(unlinked.effective_price_list.source).toBe("channel");
      expect(unlinked.history[0].revoked_by.name).toBeTruthy();
      await go(page, `${WS}/sa/en/products`);
      await pricesOn(page, /7\.00/);
      ev("13b", {
        channel_price_before: "7.00",
        partner_price_after_link: "5.00",
        channel_price_after_unlink: "7.00",
        audit: "history keeps who linked and who unlinked, with timestamps",
      });
    });

    test("13c order history: the buyer sees their own order and its detail; another buyer's order is one not-found", async () => {
      const linkedToken = (
        await login(seed.hosts.ws, seed.seeded_buyers.linked.email)
      ).token as string;
      const foreignOrderId = await placeApiOrder(
        linkedToken,
        "e2e-foreign-order-1",
      );

      await go(page, `${WS}/sa/en/buyer/orders`);
      const row = page.getByRole("link", { name: /CORD-\d{4}-\d+/ });
      await expect(row).toHaveCount(1); // only this buyer's single order, never the other buyer's
      await shot(page, "13c-order-history");
      const number = (await row.innerText()).match(/CORD-\d{4}-\d+/)?.[0];
      resetBuckets();
      await row.click();
      await page.waitForURL(/\/buyer\/orders\/[0-9a-f-]{36}$/);
      await pricesOn(page, /7\.00/);
      await pricesOn(page, /9\.00/);
      await expect(
        page.getByText(en.wholesaleBuyer.orders.notPaidNote),
      ).toBeVisible();
      await shot(page, "13c-order-detail");

      await go(page, `${WS}/sa/en/buyer/orders/${foreignOrderId}`);
      await expect(
        page.getByText(en.wholesaleBuyer.orders.notFoundTitle).first(),
      ).toBeVisible();
      expect(await bodyText(page)).not.toMatch(/CORD-\d{4}-\d+/);
      await shot(page, "13c-foreign-order-not-found");
      ev("13c", {
        own_orders_listed: 1,
        own_order_number_shape: number?.replace(/\d/g, "9"),
        detail_lines_priced: ["7.00", "9.00"],
        foreign_order_detail: "not-found state, no data",
      });
    });

    test("14 suspension: gated again, cart/checkout refused; reinstatement restores access", async () => {
      expect(await staffTransition(email, "suspend")).toBe("suspended");
      await go(page, `${WS}/sa/en/products`);
      // Batch L finding fixed: a suspended buyer is told they are suspended, not that they are "not approved yet"
      await expect(
        page
          .getByText(en.wholesaleBuyer.gate.membership.suspended.title)
          .first(),
      ).toBeVisible();
      expect(await bodyText(page)).not.toContain("has not been approved yet");
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

    test("C09 a WS cart cookie replayed on another channel, by a buyer who IS approved there, reveals and resolves nothing", async () => {
      // Give the same buyer a genuine approved membership on WS2 so the request passes the token/membership
      // gates and actually reaches cart resolution (otherwise this would only repeat C01's token-binding check).
      const t2 = (await login(seed.hosts.ws2, S.linked.email)).token as string;
      resetBuckets();
      const apply = await gw(seed.hosts.ws2, "POST", "wholesale/application", {
        token: t2,
      });
      expect([200, 201]).toContain(apply.status);
      expect(
        await staffTransition(S.linked.email, "approve", seed.channel_ids.ws2),
      ).toBe("approved");
      resetBuckets();
      const reaches = await gw(seed.hosts.ws2, "GET", "products", {
        token: t2,
      });
      expect(reaches.status).toBe(200); // proves the destination-channel session is valid and approved

      resetBuckets();
      const replay = await gw(seed.hosts.ws2, "GET", "cart", {
        token: t2,
        cart: p1CartCookie,
      });
      expect(replay.status).toBeLessThan(500);
      const leaked = JSON.stringify(replay.json ?? {});
      expect(leaked).not.toContain(seed.products.p1);
      expect(replay.json?.data?.items ?? []).toHaveLength(0);

      // the other direction: the same WS cart cookie with no buyer identity on the retail channel
      resetBuckets();
      const dtc = await gw(seed.hosts.dtc, "GET", "cart", {
        cart: p1CartCookie,
      });
      expect(JSON.stringify(dtc.json ?? {})).not.toContain(seed.products.p1);
      expect(dtc.json?.data?.items ?? []).toHaveLength(0);
      ev("C09", {
        buyer_approved_on_destination_channel: true,
        destination_channel_catalogue: reaches.status,
        ws_cart_cookie_on_ws2_status: replay.status,
        ws_cart_cookie_on_ws2_items: (replay.json?.data?.items ?? []).length,
        ws_cart_cookie_on_retail_status: dtc.status,
        ws_cart_cookie_on_retail_items: (dtc.json?.data?.items ?? []).length,
        cart_contents_leaked: false,
      });
    });

    test("C10 duplicate checkout submission with one idempotency key yields one order; another buyer cannot read it", async () => {
      resetBuckets();
      // the journey (13c) already placed one order for this buyer: this test must add exactly ONE more, however often it is submitted
      const ordersBefore = php("wholesale-e2e-evidence.php", [
        S.linked.email,
      ]).orders.filter(
        (o: any) => o.owned_by_expected_identity === true,
      ).length;
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
      expect(mine).toHaveLength(ordersBefore + 1);
      const newest = mine.at(-1);
      expect(newest.lines[0].unit_price_minor).toBe(500);
      expect(newest.lines[0].price_source).toBe("price_list");

      // buyer B (not the owner) cannot read order A's payment state
      const other = (await login(seed.hosts.ws, S.approved_unlinked.email))
        .token!;
      resetBuckets();
      const peek = await gw(
        seed.hosts.ws,
        "GET",
        `orders/${newest.id}/payment-status`,
        { token: other },
      );
      expect(peek.status).toBe(404);
      // and the buyer-account endpoints (Batch M): another buyer's order is one 404, the owner reads it
      resetBuckets();
      expect(
        (
          await gw(seed.hosts.ws, "GET", `buyer/orders/${newest.id}`, {
            token: other,
          })
        ).status,
      ).toBe(404);
      resetBuckets();
      expect(
        (
          await gw(seed.hosts.ws, "GET", `buyer/orders/${newest.id}`, {
            token: linked,
          })
        ).status,
      ).toBe(200);
      resetBuckets();
      const theirs = await gw(seed.hosts.ws, "GET", "buyer/orders", {
        token: other,
      });
      expect(theirs.status).toBe(200);
      expect(
        (theirs.json.data as Array<{ id: string }>).map((o) => o.id),
      ).not.toContain(newest.id);
      ev("C10", {
        first_complete: a.status,
        replay_same_key: b.status,
        orders_added_by_this_checkout: mine.length - ordersBefore,
        line_unit_minor: newest.lines[0].unit_price_minor,
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
      // assert what the shopper sees, not just that rows exist
      await expect(
        page.getByRole("heading", { name: en.awjCheckout.success.heading }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByText(en.awjCheckout.success.notPaidNote),
      ).toBeVisible();
      expect(
        (await bodyText(page)).match(/[A-Z]{2,}-\d{4}-\d{3,}/)?.[0],
        "order number shown on the retail confirmation",
      ).toBeTruthy();
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
  test("F01 repeated page loads from the storefront server no longer exhaust a shared per-IP bucket", async ({
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
        "gateway-authenticated reads are budgeted per storefront (600/min default), not per connection IP",
      anonymous_retail_12_loads: {
        outcomes: retail,
        first_failed_load: first(retail),
      },
      signed_in_wholesale_buyer_12_loads: {
        outcomes: buyer,
        first_failed_load: first(buyer),
      },
    });
    // Batch L measured the 4th load failing for everyone; with the per-storefront budget all 12 succeed
    expect(first(retail)).toBeNull();
    expect(first(buyer)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════
//  G. PASSWORD RESET IN THE BROWSER (H6 Batch M)
// ═════════════════════════════════════════════════════════════════
test.describe
  .serial("@desktop buyer password reset", () => {
    const buyer = seed.seeded_buyers.resettable.email;
    const newPassword = "E2e-brand-new-pass-1";

    test("G01 forgot-password is neutral; the mailed link sets a new password once; old password and old session die", async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const page = await ctx.newPage();
      // a live session that the reset must end
      const sessionBefore = (await login(seed.hosts.ws, buyer)).token as string;
      expect(
        (await gw(seed.hosts.ws, "GET", "me", { token: sessionBefore })).status,
      ).toBe(200);

      // neutral request for a known and an unknown address: identical visible outcome
      for (const address of [buyer, "nobody-here@e2e.test"]) {
        await go(page, `${WS}/sa/en/buyer/forgot-password`);
        await page.getByLabel(en.wholesaleBuyer.signIn.email).fill(address);
        await click(
          page,
          page.getByRole("button", { name: en.wholesaleBuyer.forgot.submit }),
        );
        await expect(
          page.getByText(en.wholesaleBuyer.forgot.doneBody),
        ).toBeVisible();
      }
      await shot(page, "G01-forgot-neutral");

      const link = resetLink(buyer);
      expect(link.hostname).toBe(seed.hosts.ws);
      expect(link.pathname).toMatch(/\/buyer\/reset-password$/);
      const local = `${WS}${link.pathname}${link.search}`;

      await go(page, local);
      await page
        .getByLabel(en.wholesaleBuyer.reset.newPassword, { exact: true })
        .fill(newPassword);
      await page
        .getByLabel(en.wholesaleBuyer.reset.confirmPassword, { exact: true })
        .fill(newPassword);
      await click(
        page,
        page.getByRole("button", { name: en.wholesaleBuyer.reset.submit }),
      );
      await expect(
        page.getByText(en.wholesaleBuyer.reset.successTitle),
      ).toBeVisible();
      await shot(page, "G01-reset-done");

      // the link is single-use
      await go(page, local);
      await page
        .getByLabel(en.wholesaleBuyer.reset.newPassword, { exact: true })
        .fill("Another-pass-22");
      await page
        .getByLabel(en.wholesaleBuyer.reset.confirmPassword, { exact: true })
        .fill("Another-pass-22");
      await click(
        page,
        page.getByRole("button", { name: en.wholesaleBuyer.reset.submit }),
      );
      await expect(
        page.getByText(en.wholesaleBuyer.reset.failedTitle),
      ).toBeVisible();

      // old password refused, new accepted; the pre-reset session token is dead server-side
      expect((await login(seed.hosts.ws, buyer, seed.password)).status).toBe(
        422,
      );
      expect((await login(seed.hosts.ws, buyer, newPassword)).status).toBe(200);
      resetBuckets();
      expect(
        (await gw(seed.hosts.ws, "GET", "me", { token: sessionBefore })).status,
      ).toBe(401);
      ev("G01", {
        forgot_known_and_unknown: "same neutral confirmation",
        mail_link_host_matches_channel: true,
        new_password_works: true,
        old_password_refused: true,
        link_single_use: true,
        pre_reset_session_after_reset: 401,
      });
      await ctx.close();
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
    const wb = ar.wholesaleBuyer;
    // every page is measured only after its real content (not the empty streaming shell) is on screen
    for (const [name, url, anchor] of [
      [
        "gate",
        `${WS}/sa/ar/products`,
        () => page.getByText(wb.gate.sign_in_required.title).first(),
      ],
      [
        "sign-in",
        `${WS}/sa/ar/buyer/sign-in`,
        () => page.getByLabel(wb.signIn.email),
      ],
      [
        "register",
        `${WS}/sa/ar/buyer/register`,
        () => page.getByLabel(wb.register.displayName),
      ],
    ] as const) {
      await go(page, url);
      await expect(anchor()).toBeVisible({ timeout: 20_000 });
      expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shot(page, `E01-${name}`);
    }
    ev("E01", {
      rtl: true,
      horizontal_overflow_px: 0,
      measured_after_content_visible: [
        "gate title",
        "sign-in e-mail field",
        "register name field",
      ],
    });
  });

  test("E02 approved buyer on a phone: priced listing, a real cart line and the checkout form fit the viewport", async ({
    page,
  }) => {
    await signIn(page, seed.seeded_buyers.linked.email, "ar");
    await go(page, `${WS}/sa/ar/products`);
    await expect(page.getByText("صنف جملة أول").first()).toBeVisible({
      timeout: 20_000,
    });
    await pricesOn(page, /5\.00/);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E02-listing");

    // put one real line in the cart so the cart and checkout screens are populated, not empty states
    await click(page, page.getByRole("button", { name: /أضف للسلة/ }).first());
    await page.waitForTimeout(1500);
    await go(page, `${WS}/sa/ar/cart`);
    await expect(page.getByText("صنف جملة أول").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(ar.checkout.emptyCart)).toHaveCount(0);
    await pricesOn(page, /5\.00/);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E02-cart");

    await go(page, `${WS}/sa/ar/checkout`);
    await expect(page.getByText(ar.checkout.returnToCart).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("input:visible").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(ar.checkout.emptyCart)).toHaveCount(0);
    await pricesOn(page, /5\.00/);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E02-checkout");
    ev("E02", {
      listing_cart_checkout_overflow_px: 0,
      cart_has_real_line: true,
      checkout_form_input_visible: true,
    });
  });
  test("E03 forgot-password, reset and order history render RTL on a phone with no overflow", async ({
    page,
  }) => {
    const wb = ar.wholesaleBuyer;
    await go(page, `${WS}/sa/ar/buyer/forgot-password`);
    await expect(page.getByLabel(wb.signIn.email)).toBeVisible({
      timeout: 20_000,
    });
    expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E03-forgot");

    await go(page, `${WS}/sa/ar/buyer/reset-password`); // no token: the "request a new link" state
    await expect(page.getByText(wb.reset.missingToken)).toBeVisible({
      timeout: 20_000,
    });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E03-reset-missing-token");

    await signIn(page, seed.seeded_buyers.linked.email, "ar");
    await go(page, `${WS}/sa/ar/buyer/orders`);
    await expect(
      page.getByRole("link", { name: /CORD-\d{4}-\d+/ }).first(),
    ).toBeVisible({ timeout: 20_000 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await shot(page, "E03-orders");
    ev("E03", { forgot_reset_orders_rtl: true, horizontal_overflow_px: 0 });
  });
});

// ───────────────────────── H6 Final Closure: real 404s, legacy redirects, headers, cookies, nav ─────────────────────────
// Status codes are asserted on the FIRST navigation response: a Next page that calls notFound() after streaming
// has begun answers 200 with a "not found" body, which is exactly the defect these tests exist to catch.
const UNKNOWN = base("no-such-store.e2e.localhost");
const status = async (page: Page, url: string) => {
  resetBuckets();
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  return response?.status() ?? 0;
};

test.describe
  .serial("@desktop final closure — status codes, redirects, headers, cookies", () => {
    test("H01 a retail host answers a REAL 404 for every native buyer page and every Spree-era wholesale URL", async ({
      page,
    }) => {
      const results: Record<string, number> = {};
      for (const p of [
        "/sa/en/buyer/sign-in",
        "/sa/en/buyer/register",
        "/sa/en/buyer/membership",
        "/sa/en/buyer/orders",
        "/sa/en/buyer/forgot-password",
        "/sa/en/buyer/quick-order",
        "/sa/ar/buyer/reset-password",
        "/sa/en/wholesale",
        "/sa/en/wholesale/sign-in",
        "/sa/en/wholesale/apply",
        "/sa/en/wholesale/cart",
        "/sa/en/wholesale/quick-order",
        "/sa/en/checkout/abc",
      ]) {
        results[p] = await status(page, `${DTC}${p}`);
        expect(results[p], p).toBe(404);
      }
      // …while the retail storefront itself is untouched
      for (const p of [
        "/sa/en",
        "/sa/en/products",
        "/sa/ar/products",
        "/sa/en/cart",
      ]) {
        expect(await status(page, `${DTC}${p}`), p).toBe(200);
      }
      ev("H01", { retail_closed_paths: results });
    });

    test("H02 an unknown tenant host is a real 404 (no empty storefront shell); a known host is unaffected", async ({
      page,
    }) => {
      expect(await status(page, `${UNKNOWN}/sa/en`)).toBe(404);
      expect(await status(page, `${UNKNOWN}/sa/en/products`)).toBe(404);
      expect(await status(page, `${base(seed.hosts.other_tenant)}/sa/en`)).toBe(
        200,
      );
      expect(await status(page, `${WS}/sa/en/products`)).toBe(200);
      ev("H02", { unknown_host_status: 404, known_hosts: 200 });
    });

    test("H03 a wholesale host serves the native buyer pages and sends legacy /wholesale/* to their native equivalents", async ({
      page,
    }) => {
      expect(await status(page, `${WS}/sa/en/buyer/sign-in`)).toBe(200);
      const landed: Record<string, string> = {};
      for (const [from, to] of [
        ["/sa/en/wholesale", "/sa/en/buyer/sign-in"],
        ["/sa/en/wholesale/sign-in", "/sa/en/buyer/sign-in"],
        ["/sa/en/wholesale/apply", "/sa/en/buyer/membership"],
        ["/sa/en/wholesale/cart", "/sa/en/cart"],
        ["/sa/en/wholesale/products", "/sa/en/products"],
        ["/sa/en/wholesale/quick-order", "/sa/en/buyer/quick-order"],
      ] as const) {
        await go(page, `${WS}${from}?src=legacy`);
        const url = new URL(page.url());
        expect(url.pathname, from).toBe(to);
        expect(url.search, from).toBe("?src=legacy");
        landed[from] = url.pathname;
      }
      // no native equivalent ⇒ closed, never redirected somewhere unrelated
      expect(await status(page, `${WS}/sa/en/wholesale/whatever`)).toBe(404);
      ev("H03", { legacy_redirects: landed, unknown_legacy_path: 404 });
    });

    test("H04 on a wholesale host the account and order-history links lead to the native buyer pages; on retail they do not change", async ({
      page,
    }) => {
      await go(page, `${WS}/sa/en/products`);
      const wsHrefs = await page
        .locator("footer a")
        .evaluateAll((as) =>
          as.map((a) => (a as HTMLAnchorElement).getAttribute("href")),
        );
      expect(wsHrefs).toContain("/sa/en/buyer/membership");
      expect(wsHrefs).toContain("/sa/en/buyer/orders");
      expect(wsHrefs).not.toContain("/sa/en/account");
      expect(wsHrefs).not.toContain("/sa/en/account/orders");

      await go(page, `${DTC}/sa/en/products`);
      const dtcHrefs = await page
        .locator("footer a")
        .evaluateAll((as) =>
          as.map((a) => (a as HTMLAnchorElement).getAttribute("href")),
        );
      expect(dtcHrefs).toContain("/sa/en/account");
      expect(dtcHrefs).toContain("/sa/en/account/orders");
      expect(dtcHrefs).not.toContain("/sa/en/buyer/orders");
      ev("H04", { ws_account_native: true, dtc_account_unchanged: true });
    });

    test("H05 baseline security headers are present; no resource-restricting CSP", async ({
      page,
    }) => {
      resetBuckets();
      const response = await page.goto(`${DTC}/sa/en/products`, {
        waitUntil: "domcontentloaded",
      });
      const h = response?.headers() ?? {};
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["strict-transport-security"]).toBe("max-age=31536000");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["content-security-policy"]).toBe("frame-ancestors 'none'");
      // the page still renders and hydrates under those headers (no console errors from blocked resources)
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await go(page, `${DTC}/sa/en/products`);
      await expect(page.getByText("صنف تجزئة").first()).toBeVisible();
      expect(
        errors.filter((e) => /Content Security Policy|Refused to/i.test(e)),
      ).toEqual([]);
      ev("H05", {
        headers: Object.keys(h).filter((k) =>
          /^(x-|strict|referrer|permissions|content-security)/.test(k),
        ),
      });
    });

    test("H06 the locale cookies are HttpOnly + SameSite=Lax (names and values unchanged) and locale switching still works", async ({
      page,
      context,
    }) => {
      await go(page, `${DTC}/sa/en/products`);
      const cookies = await context.cookies();
      for (const name of ["spree_country", "spree_locale"]) {
        const c = cookies.find((x) => x.name === name);
        expect(c, name).toBeTruthy();
        expect(c?.httpOnly, name).toBe(true);
        expect(c?.sameSite, name).toBe("Lax");
      }
      expect(cookies.find((x) => x.name === "spree_locale")?.value).toBe("en");
      await go(page, `${DTC}/sa/ar/products`);
      expect(
        (await context.cookies()).find((x) => x.name === "spree_locale")?.value,
      ).toBe("ar");
      ev("H06", { httpOnly: true, sameSite: "Lax", locale_switch: "en→ar" });
    });

    test("H07 a bare country path goes to that market's root, not /sa/ar/sa", async ({
      page,
    }) => {
      resetBuckets();
      await page.goto(`${DTC}/sa`, { waitUntil: "domcontentloaded" });
      expect(new URL(page.url()).pathname).toMatch(/^\/sa\/(ar|en)\/?$/);
      expect(await status(page, page.url())).toBe(200);
      ev("H07", { landed: new URL(page.url()).pathname });
    });
  });

test.describe("@mobile final closure on a phone viewport (Arabic)", () => {
  test("H08 retail 404 for buyer pages and legacy wholesale, and wholesale redirect, on a phone in Arabic", async ({
    page,
  }) => {
    expect(await status(page, `${DTC}/sa/ar/buyer/sign-in`)).toBe(404);
    expect(await status(page, `${DTC}/sa/ar/wholesale/cart`)).toBe(404);
    expect(await status(page, `${UNKNOWN}/sa/ar`)).toBe(404);
    await go(page, `${WS}/sa/ar/wholesale/apply`);
    expect(new URL(page.url()).pathname).toBe("/sa/ar/buyer/membership");
    expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    ev("H08", { rtl: true, horizontal_overflow_px: overflow });
  });
});

/** Every money figure on the cart page, sorted: two carts with the same lines and totals have the same signature. */
const cartMoney = (text: string) => (text.match(/\d+\.\d\d/g) ?? []).sort();
const bodyTextOf = async (page: Page, url: string) => {
  await go(page, url);
  return bodyText(page);
};
/** Sign in as an identity that has NO approved membership on this host: success lands on the membership page too. */
const signInUnapproved = (page: Page, email: string, origin: string) =>
  signIn(page, email, "en", origin);

// ───────────────────────── H6 Quick Order (native replacement for the Spree quick-order page) ─────────────────────────
const QO = seed.quick_order;
const qoBuyer = seed.seeded_buyers.qo.email;
const money = (page: Page, re: RegExp) =>
  expect.poll(() => bodyText(page), { timeout: 20_000 }).toMatch(re);

test.describe
  .serial("@desktop quick order by SKU", () => {
    let ctx: BrowserContext;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      page = await ctx.newPage();
    });
    test.afterAll(async () => ctx.close());

    const q = (id: string) => page.getByTestId(id);
    const pasteAndImport = async (text: string) => {
      resetBuckets();
      await q("qo-paste").fill(text);
      await q("qo-import").click();
    };

    test("Q01 a signed-out visitor gets the sign-in gate, not the form", async () => {
      await go(page, `${WS3}/sa/en/buyer/quick-order`);
      await expect(
        page.getByText(en.wholesaleBuyer.gate.sign_in_required.title),
      ).toBeVisible();
      await expect(q("quick-order")).toHaveCount(0);
      ev("Q01", { signed_out_gate: true });
    });

    test("Q02 an approved buyer resolves an exact SKU and adds it; the cart shows the server price and total", async () => {
      await signIn(page, qoBuyer, "en", WS3);
      await go(page, `${WS3}/sa/en/buyer/quick-order`);
      await expect(q("quick-order")).toBeVisible();

      await pasteAndImport("QO-COFFEE 3");
      await expect(q("qo-line")).toHaveCount(1);
      await expect(q("qo-line")).toHaveAttribute("data-sku", "QO-COFFEE");
      await money(page, /7\.00/); // channel list price, not the 10.00 sale price
      await expect(q("qo-total")).toContainText("21.00");
      expect(await bodyText(page)).not.toMatch(/10\.00/);
      await shot(page, "Q02-exact-sku-ready");

      resetBuckets();
      await q("qo-submit").click();
      await expect(q("qo-added")).toBeVisible({ timeout: 20_000 });
      await expect(q("qo-empty")).toBeVisible();

      await go(page, `${WS3}/sa/en/cart`);
      await money(page, /Quick Coffee|قهوة سريعة/);
      await money(page, /21\.00/);
      await shot(page, "Q02-cart-after-add");
      ev("Q02", { sku: "QO-COFFEE", qty: 3, unit: "7.00", total: "21.00" });
    });

    test("Q03 a variant is found by its OWN sku and priced per variant", async () => {
      await go(page, `${WS3}/sa/en/buyer/quick-order`);
      resetBuckets();
      await page
        .getByRole("textbox", {
          name: en.wholesaleBuyer.quickOrder.search.title,
        })
        .fill("QO-SHIRT-RED");
      await expect(q("qo-results")).toBeVisible({ timeout: 20_000 });
      await q("qo-pick").first().click();
      await expect(q("qo-line")).toHaveAttribute("data-sku", "QO-SHIRT-RED");
      await expect(q("qo-line")).toContainText("25.00");
      await q("qo-qty").fill("2");
      await expect(q("qo-total")).toContainText("50.00");
      await shot(page, "Q03-variant-sku");
      ev("Q03", {
        variant_sku: "QO-SHIRT-RED",
        unit: "25.00",
        qty: 2,
        total: "50.00",
      });
    });

    test("Q04 multiple lines with an invalid SKU, an ambiguous parent SKU and an unavailable item: review, then add only what is eligible", async () => {
      await go(page, `${WS3}/sa/en/buyer/quick-order`);
      await pasteAndImport(
        "QO-COFFEE 1\nQO-SHIRT-RED 2\nNOPE-404 5\nQO-TEA 1\nQO-SHIRT 1",
      );

      await expect(q("qo-paste-issues")).toContainText("NOPE-404");
      await expect(q("qo-paste-issues")).toContainText("not found");
      await expect(q("qo-paste-issues")).toContainText("several variants");
      // the ambiguous parent hands its variants to the picker
      await expect(q("qo-results")).toBeVisible();

      const lines = q("qo-line");
      await expect(lines).toHaveCount(3); // coffee, shirt-red, tea
      const tea = page.locator('[data-testid="qo-line"][data-sku="QO-TEA"]');
      await expect(tea).toHaveAttribute("data-state", "unavailable");
      await expect(tea).toContainText(
        en.wholesaleBuyer.quickOrder.reason.noWholesalePrice,
      );
      expect(await tea.innerText()).not.toMatch(/\d+\.\d\d/);
      await expect(q("qo-submit")).toContainText("(2)");
      await shot(page, "Q04-review-mixed");

      resetBuckets();
      await q("qo-submit").click();
      await expect(q("qo-added")).toBeVisible({ timeout: 20_000 });
      // the unavailable line stays in the list for the buyer to see and remove
      await expect(q("qo-line")).toHaveCount(1);
      await expect(q("qo-line")).toHaveAttribute("data-sku", "QO-TEA");

      await go(page, `${WS3}/sa/en/cart`);
      const text = await bodyText(page);
      expect(text).toMatch(/Quick Coffee|قهوة سريعة/);
      expect(text).toMatch(/Quick Shirt|قميص سريع/);
      expect(text).not.toMatch(/Quick Tea|شاي سريع/);
      ev("Q04", {
        added: 2,
        not_added: [
          "NOPE-404 (unknown)",
          "QO-TEA (no wholesale price)",
          "QO-SHIRT (ambiguous)",
        ],
      });
    });

    test("Q05 quantity errors are caught in the form before anything is sent", async () => {
      await go(page, `${WS3}/sa/en/buyer/quick-order`);
      await pasteAndImport("QO-COFFEE 1");
      for (const bad of ["0", "-2", "1.5", "abc", ""]) {
        await q("qo-qty").fill(bad);
        await expect(q("qo-line")).toHaveAttribute("data-state", "invalid");
        await expect(q("qo-submit")).toBeDisabled();
      }
      await q("qo-qty").fill("1000000");
      await expect(q("qo-line")).toContainText("cannot exceed");
      await expect(q("qo-submit")).toBeDisabled();
      await q("qo-qty").fill("2");
      await expect(q("qo-submit")).toBeEnabled();
      await shot(page, "Q05-quantity-errors");
      ev("Q05", { rejected: ["0", "-2", "1.5", "abc", "", "1000000"] });
    });

    test("Q06 if the price disappears between review and submit, the server rejects the WHOLE batch and nothing is added", async () => {
      const before = cartMoney(await bodyTextOf(page, `${WS3}/sa/en/cart`));
      await go(page, `${WS3}/sa/en/buyer/quick-order`);
      await pasteAndImport("QO-COFFEE 1\nQO-SHIRT-RED 1");
      await expect(q("qo-line")).toHaveCount(2);

      // approved price of the shirt variant is withdrawn after the review
      php("wholesale-e2e-price.php", ["QO-SHIRT-RED", "none"]);
      try {
        resetBuckets();
        await q("qo-submit").click();
        await expect(q("qo-rejected")).toBeVisible({ timeout: 20_000 });
        await expect(q("qo-rejected")).toContainText("Nothing was added");
        await expect(q("qo-line")).toHaveCount(2); // nothing was removed from the list
        await expect(
          page.locator('[data-testid="qo-line"][data-sku="QO-SHIRT-RED"]'),
        ).toHaveAttribute("data-state", "rejected");
        await expect(
          page.locator('[data-testid="qo-line"][data-sku="QO-COFFEE"]'),
        ).toHaveAttribute("data-state", "ready");
      } finally {
        php("wholesale-e2e-price.php", ["QO-SHIRT-RED", "2500"]);
      }
      expect(cartMoney(await bodyTextOf(page, `${WS3}/sa/en/cart`))).toEqual(
        before,
      ); // the cart is exactly as it was
      ev("Q06", { atomic_rejection: true, cart_unchanged: true });
    });

    test("Q07 checkout completes natively with the quick-ordered lines; no payment is captured", async () => {
      await go(page, `${WS3}/sa/en/checkout`);
      await page.getByLabel("Full name").fill("Quick Buyer");
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
      await click(
        page,
        page.getByRole("button", { name: /continue to review/i }),
      );
      const complete = page.getByRole("button", { name: /complete order/i });
      await expect(complete).toBeVisible();
      await shot(page, "Q07-review");
      resetBuckets();
      await Promise.allSettled([
        complete.click({ timeout: 5000 }),
        complete.click({ timeout: 5000, force: true }),
      ]);
      await expect(
        page.getByRole("heading", { name: en.awjCheckout.success.heading }),
      ).toBeVisible({ timeout: 30_000 });
      await shot(page, "Q07-confirmation");
      ev("Q07", { confirmation_heading_visible: true });
    });

    test("Q08 exactly one order from the quick-ordered lines, owned by this buyer on the quick-order channel, priced by the server; nothing financial was touched", async () => {
      const out = php("wholesale-e2e-evidence.php", [qoBuyer]);
      const mine = out.orders.filter(
        (o: any) => o.owned_by_expected_identity === true,
      );
      expect(mine).toHaveLength(1);
      const o = mine[0];
      expect(o.channel_id).toBe(seed.channel_ids.ws3);
      expect(
        o.lines.map((l: any) => [l.quantity, l.unit_price_minor]).sort(),
      ).toEqual([
        [2, 2500],
        [4, 700],
      ]);
      expect(
        o.lines.every(
          (l: any) => l.price_source === "price_list" && l.price_list_id,
        ),
      ).toBe(true);
      expect(o.total_minor).toBe(4 * 700 + 2 * 2500);
      const { commerce_payment_intents: intents, ...financial } =
        out.untouched as Record<string, number>;
      for (const [k, v] of Object.entries(financial))
        expect(v, `untouched.${k}`).toBe(0);
      expect(intents).toBe(out.order_count);
      ev("Q08", {
        lines: o.lines.map((l: any) => ({
          qty: l.quantity,
          unit_minor: l.unit_price_minor,
          price_source: l.price_source,
        })),
        total_minor: o.total_minor,
        untouched_financial_tables: financial,
      });
    });

    test("Q09 a suspended buyer can sign in but gets the approval gate, and the API refuses lookup and add", async () => {
      const susp = seed.seeded_buyers.qo_suspended.email;
      const session = await login(seed.hosts.ws3, susp);
      expect(session.status).toBe(200);
      expect(
        (
          await gw(
            seed.hosts.ws3,
            "GET",
            "buyer/quick-order/lookup?q=QO-COFFEE",
            { token: session.token },
          )
        ).status,
      ).toBe(403);
      const add = await gw(seed.hosts.ws3, "POST", "buyer/quick-order/add", {
        token: session.token,
        body: {
          items: [{ product_id: QO.coffee, quantity: 1, unit_key: "base" }],
        },
      });
      expect(add.status).toBe(403);

      const p = await ctx.newPage();
      await signIn(p, susp, "en", WS3);
      await go(p, `${WS3}/sa/en/buyer/quick-order`);
      await expect(
        p.getByText(en.wholesaleBuyer.gate.membership.suspended.title),
      ).toBeVisible();
      await expect(p.getByTestId("quick-order")).toHaveCount(0);
      await shot(p, "Q09-suspended");
      await p.close();
      ev("Q09", { api_lookup: 403, api_add: 403, gate: "suspended" });
    });

    test("Q10 cross-channel: a buyer approved only on ANOTHER channel gets the gate here, and its token unlocks nothing on this host", async () => {
      const other = seed.seeded_buyers.linked.email; // approved on ws, never on ws3
      const onWs = (await login(seed.hosts.ws, other)).token as string;
      for (const h of [seed.hosts.ws3]) {
        const lookup = await gw(
          h,
          "GET",
          "buyer/quick-order/lookup?q=QO-COFFEE",
          { token: onWs },
        );
        expect([401, 403]).toContain(lookup.status);
        const add = await gw(h, "POST", "buyer/quick-order/add", {
          token: onWs,
          body: {
            items: [{ product_id: QO.coffee, quantity: 1, unit_key: "base" }],
          },
        });
        expect([401, 403]).toContain(add.status);
      }
      // signing in on ws3 as that identity yields a session without a membership there
      const p = await ctx.newPage();
      await signInUnapproved(p, other, WS3);
      await go(p, `${WS3}/sa/en/buyer/quick-order`);
      await expect(p.getByTestId("quick-order")).toHaveCount(0);
      await expect(
        p.getByText(en.wholesaleBuyer.gate.membership.none.title),
      ).toBeVisible();
      await p.close();
      ev("Q10", {
        foreign_token_status: "401/403",
        gate: "no application on this channel",
      });
    });

    test("Q11 the API never trusts the browser: prices, identities and unknown fields are refused; the gateway secret is required", async () => {
      const session = (
        await login(seed.hosts.ws3, seed.seeded_buyers.qo_other.email)
      ).token as string;
      for (const extra of [
        { price: 1 },
        { unit_price: 1 },
        { partner_id: seed.partner_id },
        { sales_channel_id: seed.channel_ids.ws },
        { tenant_id: seed.tenant_id },
      ]) {
        const r = await gw(seed.hosts.ws3, "POST", "buyer/quick-order/add", {
          token: session,
          body: {
            items: [
              {
                product_id: QO.coffee,
                quantity: 1,
                unit_key: "base",
                ...extra,
              },
            ],
          },
        });
        expect(r.status, JSON.stringify(extra)).toBe(422);
      }
      const noSecret = await gw(
        seed.hosts.ws3,
        "POST",
        "buyer/quick-order/add",
        {
          token: session,
          secret: null,
          body: {
            items: [{ product_id: QO.coffee, quantity: 1, unit_key: "base" }],
          },
        },
      );
      expect([401, 403, 404]).toContain(noSecret.status);
      ev("Q11", { forbidden_fields_refused: 5, no_secret: noSecret.status });
    });
  });

test.describe("@mobile quick order in Arabic on a phone viewport", () => {
  test("Q12 RTL layout fits the phone: search, paste, review and the full-width submit are reachable without horizontal scroll", async ({
    page,
  }) => {
    const overflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
    await signIn(page, seed.seeded_buyers.qo_other.email, "ar", WS3);
    await go(page, `${WS3}/sa/ar/buyer/quick-order`);
    await expect(page.getByTestId("quick-order")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      ar.wholesaleBuyer.quickOrder.title,
    );
    expect(await overflow()).toBeLessThanOrEqual(1);

    resetBuckets();
    await page
      .getByTestId("qo-paste")
      .fill("QO-COFFEE 2\nQO-SHIRT-RED 1\nQO-TEA 1\nNOPE-1");
    await page.getByTestId("qo-import").click();
    await expect(page.getByTestId("qo-line")).toHaveCount(3);
    await expect(page.getByTestId("qo-paste-issues")).toContainText("NOPE-1");
    await expect(page.getByTestId("qo-line").nth(0)).toContainText(
      "قهوة سريعة",
    );
    expect(await overflow()).toBeLessThanOrEqual(1);
    const submit = page.getByTestId("qo-submit");
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.width > viewport.width * 0.8).toBe(true);
    await shot(page, "Q12-mobile-arabic-review");

    resetBuckets();
    await submit.click();
    await expect(page.getByTestId("qo-added")).toBeVisible({ timeout: 20_000 });
    expect(await overflow()).toBeLessThanOrEqual(1);
    await shot(page, "Q12-mobile-arabic-added");
    ev("Q12", {
      rtl: true,
      horizontal_overflow_px: 0,
      submit_full_width: true,
    });
  });
});
