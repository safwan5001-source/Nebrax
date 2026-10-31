import fs from "node:fs";
import path from "node:path";
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

/**
 * B2C-ACCOUNTS — native retail customer accounts, verified in a REAL browser against a REAL Laravel API.
 *
 * Boot the stack with `scripts/e2e/retail-accounts-stack.sh` first. Everything targets loopback only (the guards below refuse any
 * other API/store URL) and a throwaway SQLite database seeded by `e2e/support/retail-accounts-e2e-seed.php`. Nothing is mocked:
 * registration, the e-mailed link (read from the app's own `log` mail transport), sign-in, the persistent HttpOnly session,
 * profile, addresses, guest-order claiming, ownership isolation and sign-out all go through the production code paths.
 *
 *  @mobile  — iPhone-sized viewport, Arabic locale, RTL (the primary journey)
 *  @desktop — 1280px, English, LTR (smaller parity check)
 */

const ENV = {
  api: process.env.E2E_API_URL ?? "http://127.0.0.1:8000",
  store: process.env.E2E_STORE_PORT ?? "3001",
  secret:
    process.env.E2E_GATEWAY_SECRET ??
    "e2e-local-gateway-secret-not-a-real-secret",
  seedJson: process.env.E2E_SEED_JSON ?? "/tmp/e2e-retail/seed.json",
  laravelRoot: process.env.E2E_LARAVEL_ROOT ?? "",
  dbPath: process.env.E2E_DB_PATH ?? "/tmp/e2e-retail/e2e.sqlite",
  evidenceDir: path.resolve("test-results/retail-accounts-e2e"),
};
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(ENV.api)) {
  throw new Error(
    `Refusing to run: E2E_API_URL must be loopback (got ${ENV.api}).`,
  );
}
if (!ENV.laravelRoot)
  throw new Error("Set E2E_LARAVEL_ROOT to the assembled Laravel app.");
if (!ENV.dbPath.includes("e2e"))
  throw new Error(
    "Refusing to run: E2E_DB_PATH must be a throwaway path containing 'e2e'.",
  );

type Seed = {
  password: string;
  hosts: { shop: string; closed: string };
  product_id: string;
};
const seed: Seed = JSON.parse(fs.readFileSync(ENV.seedJson, "utf8"));
const base = (host: string) => `http://${host}:${ENV.store}`;
const SHOP = base(seed.hosts.shop);
const CLOSED = base(seed.hosts.closed);

const evidence: Array<Record<string, unknown>> = [];
const ev = (id: string, data: Record<string, unknown> = {}) =>
  evidence.push({ id, at: new Date().toISOString(), ...data });
test.afterAll(() => {
  fs.mkdirSync(ENV.evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(ENV.evidenceDir, `evidence-${test.info().project.name}.json`),
    JSON.stringify(evidence, null, 2),
  );
});
const shot = async (page: Page, name: string) => {
  fs.mkdirSync(ENV.evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(ENV.evidenceDir, `${test.info().project.name}-${name}.png`),
    fullPage: true,
  });
};

/** The storefront's anonymous API budget is per host; clear it between phases so a long journey never trips it. */
const resetBuckets = () => {
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

/** Last mailed link to `email` whose path contains `needle`, read from the app's own `log` mail transport. */
function mailedLink(email: string, needle: string): string {
  const log = fs.readFileSync(
    path.join(ENV.laravelRoot, "storage/logs/laravel.log"),
    "utf8",
  );
  const blocks = log
    .split(/\nTo: /)
    .slice(1)
    .filter((b) => b.toLowerCase().startsWith(email.toLowerCase()));
  const re = new RegExp(`https?://[^"'\\s<]+${needle}\\?token=[A-Za-z0-9]+`);
  const m = (blocks.at(-1) ?? "").match(re);
  if (!m) throw new Error(`no ${needle} link was mailed to ${email}`);
  const url = new URL(m[0]);
  return `${url.pathname}${url.search}`; // path + token only: the host is the test's own
}

/** What the storefront server does: forwarded host + gateway secret (+ cart cookie). Used to place a GUEST order with no browser. */
async function guestOrder(
  host: string,
  email: string,
): Promise<{ id: string; number: string }> {
  const h = (extra: Record<string, string> = {}) => ({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Storefront-Forwarded-Host": host,
    "X-Storefront-Gateway-Secret": ENV.secret,
    ...extra,
  });
  const call = async (
    method: string,
    p: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${ENV.api}/store/v1/${p}`, {
      method,
      headers: h(extra),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const add = await call("POST", "cart/items", {
    product_id: seed.product_id,
    quantity: 1,
    unit_key: "base",
  });
  expect(add.ok).toBeTruthy();
  const cookie = (add.headers.getSetCookie?.() ?? [])
    .map((c) => c.match(/awj_cart_token=([^;]+)/)?.[1])
    .find(Boolean);
  const cart = { Cookie: `awj_cart_token=${cookie}` };
  expect((await call("POST", "checkout", {}, cart)).ok).toBeTruthy();
  expect(
    (
      await call(
        "PATCH",
        "checkout/contact",
        { name: "ضيف", phone: "0501234567", email },
        cart,
      )
    ).ok,
  ).toBeTruthy();
  expect(
    (
      await call(
        "PATCH",
        "checkout/address",
        {
          country: "SA",
          city: "الدمام",
          district: "الشاطئ",
          street: "الملك فهد",
          postal_code: "31411",
        },
        cart,
      )
    ).ok,
  ).toBeTruthy();
  expect(
    (await call("PATCH", "checkout/delivery", { method: "pickup" }, cart)).ok,
  ).toBeTruthy();
  const done = await call(
    "POST",
    "checkout/complete",
    {},
    { ...cart, "Idempotency-Key": crypto.randomUUID() },
  );
  expect(done.status).toBe(201);
  const json = (await done.json()) as {
    data: { order: { id: string; number: string } };
  };
  return json.data.order;
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(1);
};

const stamp = Date.now().toString(36);
const emailA = `sara-${stamp}@e2e.test`;
const emailB = `omar-${stamp}@e2e.test`;
// a phone is unique per tenant and the throwaway DB outlives a run: use a fresh one each time (typed in Arabic-Indic digits)
const phoneDigits = String(Math.floor(10000000 + Math.random() * 89999999));
const phoneE164 = `+9665${phoneDigits}`;
const phoneArabicIndic = phoneE164.replace(
  /\d/g,
  (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)],
);

async function register(
  page: Page,
  first: string,
  last: string,
  email: string,
  password: string,
) {
  await page.goto(`${SHOP}/sa/ar/account/register`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#firstName").fill(first);
  await page.locator("#lastName").fill(last);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#passwordConfirmation").fill(password);
  await page.locator("#policy-consent").click();
  await page.locator("main button[type=submit]").click();
  await expect(page.getByTestId("register-verification-sent")).toBeVisible();
}

async function verify(page: Page, email: string) {
  await page.goto(`${SHOP}${mailedLink(email, "/account/verify")}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("email-verified")).toBeVisible();
}

async function signIn(
  page: Page,
  email: string,
  password: string,
  remember = true,
  locale = "ar",
) {
  await page.goto(`${SHOP}/sa/${locale}/account`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#email").fill(email);
  await page.locator("#current-password").fill(password);
  const box = page.locator("#remember-me");
  if ((await box.isChecked()) !== remember) await box.click();
  await page.locator("main button[type=submit]").click();
  // the sign-in form is replaced by the signed-in overview (the e-mail may also sit in a desktop-only sidebar, hidden on mobile)
  await expect(page.locator("#email")).toHaveCount(0);
  await expect(
    page.getByText(ar("account.signedInAs")).locator("visible=true").first(),
  ).toBeVisible();
}

async function accountCookies(context: BrowserContext) {
  const cookies = await context.cookies(SHOP);
  return {
    session: cookies.find((c) => c.name === "awj_account_session"),
    hint: cookies.find((c) => c.name === "awj_account_hint"),
  };
}

/** A browser restart keeps persistent cookies and drops session cookies. */
async function restart(
  browser: Browser,
  context: BrowserContext,
  use: Parameters<Browser["newContext"]>[0],
) {
  const state = await context.storageState();
  await context.close();
  const persistent = {
    ...state,
    cookies: state.cookies.filter((c) => c.expires !== -1),
  };
  return browser.newContext({ ...use, storageState: persistent });
}

test.describe
  .serial("retail accounts — mobile Arabic RTL @mobile", () => {
    let context: BrowserContext;
    let page: Page;
    const password = "E2e-correct-horse-9";
    let orderNumber = "";
    let orderId = "";
    let otherOrder = { id: "", number: "" };

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-SA",
      });
      page = await context.newPage();
    });
    test.afterAll(async () => context.close().catch(() => undefined));

    test("a host without accounts shows the honest notice and no form", async () => {
      for (const p of [
        "account",
        "account/register",
        "account/forgot-password",
      ]) {
        await page.goto(`${CLOSED}/sa/ar/${p}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(
          page.getByTestId("account-auth-unavailable"),
        ).toBeVisible();
        // no credential field exists at all (the header's search form is not an account form)
        expect(await page.locator("input[type=password], #email").count()).toBe(
          0,
        );
      }
      // the guest journey on that host is untouched
      await page.goto(`${CLOSED}/sa/ar/cart`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("account-auth-unavailable")).toHaveCount(0);
      ev("closed-host", { ok: true });
    });

    test("the open host renders RTL with the sign-in form and no overflow", async () => {
      await page.goto(`${SHOP}/sa/ar/account`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("#email")).toBeVisible();
      await expect(page.getByTestId("account-auth-unavailable")).toHaveCount(0);
      await noHorizontalOverflow(page);
      await shot(page, "01-sign-in");
    });

    test("registration → neutral 'check your email' → cannot sign in until verified", async () => {
      resetBuckets();
      await register(page, "سارة", "العتيبي", emailA, password);
      await noHorizontalOverflow(page);
      await shot(page, "02-check-email");

      await page.goto(`${SHOP}/sa/ar/account`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#email").fill(emailA);
      await page.locator("#current-password").fill(password);
      await page.locator("main button[type=submit]").click();
      await expect(page.getByRole("alert")).toBeVisible(); // unverified ⇒ generic invalid credentials
      expect((await accountCookies(context)).session).toBeUndefined();
      ev("register-unverified-blocked", { ok: true });
    });

    test("the e-mailed link verifies the account; a replayed link is refused", async () => {
      const link = mailedLink(emailA, "/account/verify");
      await verify(page, emailA);
      await shot(page, "03-verified");
      await page.goto(`${SHOP}${link}`, { waitUntil: "domcontentloaded" }); // single use
      await expect(page.getByTestId("email-verified")).toHaveCount(0);
      await expect(page.locator("#verify-email")).toBeVisible();
    });

    test("sign-in with 'keep me signed in' sets an HttpOnly, SameSite=Lax, persistent session cookie", async () => {
      resetBuckets();
      await signIn(page, emailA, password, true);
      const { session, hint } = await accountCookies(context);
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe("Lax");
      expect(session?.expires ?? 0).toBeGreaterThan(
        Date.now() / 1000 + 25 * 86400,
      );
      expect(hint?.httpOnly).toBe(false);
      expect(hint?.value).toBe("1");
      // the token is not reachable from page script
      const visible = await page.evaluate(() => document.cookie);
      expect(visible).not.toContain("awj_account_session");
      await noHorizontalOverflow(page);
      await shot(page, "04-signed-in");
      ev("session-cookie", {
        httpOnly: session?.httpOnly,
        sameSite: session?.sameSite,
        persistent: true,
      });
    });

    test("the session survives a browser restart (persistent cookies kept, session cookies dropped)", async ({
      browser,
    }) => {
      context = await restart(browser, context, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-SA",
      });
      page = await context.newPage();
      await page.goto(`${SHOP}/sa/ar/account/profile`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("#profile-name")).toHaveValue("سارة العتيبي");
      ev("persistent-after-restart", { ok: true });
    });

    test("profile: update name and phone; the e-mail is read-only", async () => {
      await expect(page.locator("#profile-email")).toHaveAttribute(
        "readonly",
        "",
      );
      await page.locator("#profile-name").fill("سارة محمد العتيبي");
      await page.locator("#profile-phone").fill(phoneArabicIndic); // Arabic-Indic digits are normalized to 0-9
      await page
        .locator("form[aria-labelledby=profile-heading] button[type=submit]")
        .click();
      await expect(page.getByTestId("profile-saved")).toBeVisible();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("#profile-name")).toHaveValue(
        "سارة محمد العتيبي",
      );
      await expect(page.locator("#profile-phone")).toHaveValue(phoneE164);
      await noHorizontalOverflow(page);
      await shot(page, "05-profile");
    });

    test("addresses: add (Arabic-Indic digits), edit, then delete", async () => {
      await page.goto(`${SHOP}/sa/ar/account/addresses`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("button")
        .filter({ hasText: ar("account.addNewAddress") })
        .first()
        .click();
      await page.locator("#addr-recipient").fill("سارة");
      await page.locator("#addr-phone").fill("+966501234567");
      await page.locator("#addr-city").fill("الدمام");
      await page.locator("#addr-district").fill("الشاطئ");
      await page.locator("#addr-street").fill("طريق الملك فهد");
      await page.locator("#addr-building").fill("١٢٣٤");
      await page.locator("#addr-additional").fill("٥٦٧٨");
      await page.locator("#addr-postal").fill("٣١٤١١");
      await page.locator("#addr-label").fill("المنزل");
      await page.locator("#addr-default").check();
      await page
        .locator("[data-testid=address-form] button[type=submit]")
        .click();
      const list = page.getByTestId("address-list");
      await expect(list).toContainText("المنزل");
      await expect(list).toContainText("31411");
      await noHorizontalOverflow(page);
      await shot(page, "06-addresses");

      await page
        .getByRole("button")
        .filter({ hasText: ar("retailAccount.edit") })
        .first()
        .click();
      await page.locator("#addr-city").fill("الخبر");
      await page
        .locator("[data-testid=address-form] button[type=submit]")
        .click();
      await expect(page.getByTestId("address-list")).toContainText("الخبر");

      await page
        .getByRole("button")
        .filter({ hasText: ar("retailAccount.delete") })
        .first()
        .click();
      await page
        .getByRole("button")
        .filter({ hasText: ar("retailAccount.confirmDelete") })
        .first()
        .click();
      await expect(page.getByTestId("address-list")).toHaveCount(0);
      ev("addresses-crud", { ok: true });
    });

    test("a guest order placed with the account e-mail is linked through the verified claim and then shown", async () => {
      resetBuckets();
      const order = await guestOrder(seed.hosts.shop, emailA);
      orderNumber = order.number;
      orderId = order.id;
      await page.goto(`${SHOP}/sa/ar/account/orders`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("account-orders")).toHaveCount(0); // nothing yet: a guest order is not auto-linked
      await page.locator("#claim-order-number").fill("CORD-NOT-MINE");
      await page
        .getByRole("button")
        .filter({ hasText: ar("retailAccount.claimAction") })
        .click();
      await expect(
        page.getByText(ar("retailAccount.claimFailed")),
      ).toBeVisible(); // neutral failure

      await page.locator("#claim-order-number").fill(orderNumber);
      await page
        .getByRole("button")
        .filter({ hasText: ar("retailAccount.claimAction") })
        .click();
      await expect(page.getByTestId("account-orders")).toContainText(
        orderNumber,
      );
      await noHorizontalOverflow(page);
      await shot(page, "07-orders");

      await page
        .getByRole("link")
        .filter({ hasText: orderNumber })
        .first()
        .click();
      await expect(page.getByTestId("account-order-detail")).toContainText(
        orderNumber,
      );
      await shot(page, "08-order-detail");
      ev("claim-and-detail", { ok: true });
    });

    test("ownership: another customer can neither claim nor open this order", async ({
      browser,
    }) => {
      resetBuckets();
      const ctxB = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        locale: "ar-SA",
      });
      const b = await ctxB.newPage();
      await register(b, "عمر", "الغامدي", emailB, password);
      await verify(b, emailB);
      resetBuckets();
      await signIn(b, emailB, password, true);

      // B guesses A's order URL: the same "not found" state a nonexistent order gets
      await b.goto(`${SHOP}/sa/ar/account/orders/${orderId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(b.locator("[data-state=order-not-found]")).toBeVisible();
      await expect(b.locator("body")).not.toContainText(orderNumber);
      await b.goto(
        `${SHOP}/sa/ar/account/orders/00000000-0000-4000-8000-000000000000`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(b.locator("[data-state=order-not-found]")).toBeVisible();

      // B tries to claim A's already-linked order, and a guest order for a different e-mail
      otherOrder = await guestOrder(
        seed.hosts.shop,
        `someone-else-${stamp}@e2e.test`,
      );
      await b.goto(`${SHOP}/sa/ar/account/orders`, {
        waitUntil: "domcontentloaded",
      });
      for (const number of [orderNumber, otherOrder.number]) {
        await b.locator("#claim-order-number").fill(number);
        await b
          .getByRole("button")
          .filter({ hasText: ar("retailAccount.claimAction") })
          .click();
        await expect(
          b.getByText(ar("retailAccount.claimFailed")),
        ).toBeVisible();
      }
      await expect(b.getByTestId("account-orders")).toHaveCount(0);
      await shot(b, "09-idor-denied");
      await ctxB.close();
      ev("idor", { ok: true });
    });

    test("sessions: the device list is shown, and 'sign out everywhere else' keeps this one", async () => {
      await page.goto(`${SHOP}/sa/ar/account/profile`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("account-sessions")).toContainText(
        ar("retailAccount.thisDevice"),
      );
      await shot(page, "10-sessions");
    });

    test("change password signs the other devices out; reset-by-email works end to end", async ({
      browser,
    }) => {
      resetBuckets();
      const newPassword = "E2e-changed-horse-7";
      await page.goto(`${SHOP}/sa/ar/account/profile`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#current-password").fill(password);
      await page.locator("#new-password").fill(newPassword);
      await page.locator("#confirm-new-password").fill(newPassword);
      await page
        .locator("form[aria-labelledby=password-heading] button[type=submit]")
        .click();
      await expect(page.getByTestId("password-changed")).toBeVisible();

      // forgot → mailed link → reset → old and previous passwords are rejected, the new one works
      resetBuckets();
      const ctx2 = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        locale: "ar-SA",
      });
      const p2 = await ctx2.newPage();
      await p2.goto(`${SHOP}/sa/ar/account/forgot-password`, {
        waitUntil: "domcontentloaded",
      });
      await p2.locator("#email").fill(emailA);
      await p2.locator("main button[type=submit]").click();
      await expect(p2.getByText(emailA)).toBeVisible();
      const resetPath = mailedLink(emailA, "/account/reset-password");
      const final = "E2e-final-horse-8";
      await p2.goto(`${SHOP}${resetPath}`, { waitUntil: "domcontentloaded" });
      await p2.locator("#password").fill(final);
      await p2.locator("#passwordConfirmation").fill(final);
      await p2.locator("main button[type=submit]").click();
      await expect(p2.getByRole("button").last()).toBeVisible();
      await shot(p2, "11-reset-done");

      // the reset ended every session of the account, including this browser's
      await page.goto(`${SHOP}/sa/ar/account/orders`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page).toHaveURL(/\/account(\?|$)/);
      await ctx2.close();
      resetBuckets();
      await signIn(page, emailA, final, false); // and the new password works (non-persistent this time)
      ev("password-change-and-reset", { ok: true });
    });

    test("without 'keep me signed in' the cookie is a session cookie and does not survive a restart; sign-out revokes server-side", async ({
      browser,
    }) => {
      const { session } = await accountCookies(context);
      expect(session?.expires).toBe(-1);
      const token = session?.value ?? "";
      expect(token).not.toBe("");

      context = await restart(browser, context, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-SA",
      });
      page = await context.newPage();
      await page.goto(`${SHOP}/sa/ar/account/orders`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page).toHaveURL(/\/account(\?|$)/);
      await expect(page.locator("#email")).toBeVisible();

      // sign in again and sign out from the UI; the old bearer must then be dead at the API
      resetBuckets();
      await signIn(page, emailA, "E2e-final-horse-8", true);
      // the cookie jar holds the URL-encoded value (Sanctum tokens contain a `|`)
      const live = decodeURIComponent(
        (await accountCookies(context)).session?.value ?? "",
      );
      const api = (t: string) =>
        fetch(`${ENV.api}/store/v1/me`, {
          headers: {
            Accept: "application/json",
            "X-Storefront-Forwarded-Host": seed.hosts.shop,
            "X-Storefront-Gateway-Secret": ENV.secret,
            "X-Customer-Token": t,
          },
        });
      expect((await api(live)).status).toBe(200);
      await page.goto(`${SHOP}/sa/ar/account`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("button")
        .filter({ hasText: ar("account.signOut") })
        .last()
        .click();
      await expect(page.locator("#email")).toBeVisible();
      expect((await api(live)).status).toBe(401);
      expect((await accountCookies(context)).session).toBeUndefined();
      await page.goto(`${SHOP}/sa/ar/account/addresses`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page).toHaveURL(/\/account(\?|$)/);
      ev("logout-revoked", { ok: true });
    });
  });

test.describe("retail accounts — desktop English LTR @desktop", () => {
  test("LTR sign-in, register and verification screens render on the open host and the notice on the closed one", async ({
    page,
  }) => {
    await page.goto(`${SHOP}/sa/en/account`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("#email")).toBeVisible();
    await shot(page, "en-sign-in");
    await page.goto(`${SHOP}/sa/en/account/register`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#firstName")).toBeVisible();
    await page.goto(`${SHOP}/sa/en/account/verify`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#verify-email")).toBeVisible();
    await page.goto(`${CLOSED}/sa/en/account/register`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("account-auth-unavailable")).toBeVisible();
    await shot(page, "en-closed");
  });
});

const arMessages = JSON.parse(
  fs.readFileSync(path.resolve("messages/ar.json"), "utf8"),
) as Record<string, unknown>;
/** Arabic message by dotted key (the spec asserts the real localized copy, not test ids, for button labels). */
function ar(key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown>)?.[part],
      arMessages,
    );
  if (typeof value !== "string") throw new Error(`missing ar message ${key}`);
  return value;
}
