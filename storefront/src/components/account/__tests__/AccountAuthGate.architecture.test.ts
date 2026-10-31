import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_AUTH_CAPABILITY } from "@/lib/commerce/capabilities";

/**
 * SPREE-X1 structural guards for the gated buyer-account surface.
 *
 * While buyer authentication is `gated`, the Spree SDK must not be reachable
 * from the screens a shopper can hit, and every server action in
 * `lib/data/customer.ts` must check the gate BEFORE any Spree access. These are
 * source-level checks so a regression fails even if no runtime test exercises
 * the path.
 */
const SRC = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const ACCOUNT_PAGES = [
  "app/[country]/[locale]/(storefront)/account/register/page.tsx",
  "app/[country]/[locale]/(storefront)/account/forgot-password/page.tsx",
  "app/[country]/[locale]/(storefront)/account/reset-password/page.tsx",
  "app/[country]/[locale]/(storefront)/account/verify/page.tsx",
  "components/account/AccountSignIn.tsx",
];

describe("customer account host gate (B2C-ACCOUNTS)", () => {
  it("is built (live) — and live means 'the code exists', not 'every store has accounts'", () => {
    expect(ACCOUNT_AUTH_CAPABILITY).toBe("live");
  });

  it("every public auth screen renders inside AccountsGate (the API's per-host answer), never a bare form", () => {
    for (const page of ACCOUNT_PAGES) {
      const src = read(page);
      expect(src, page).toContain("AccountsGate");
      expect(src, page).not.toContain("ACCOUNT_AUTH_CAPABILITY");
    }
    const gate = read("components/account/AccountsGate.tsx");
    expect(gate).toContain("AccountAuthUnavailable");
    expect(gate).toContain("accountsAvailable");
  });

  it("the host answer is fail-closed: only a literal true opens accounts", () => {
    const src = read("lib/commerce/storefront.ts");
    expect(src).toContain("value.customer_accounts === true");
    const action = read("lib/data/customer.ts");
    expect(action).toContain("customerAccounts === true");
    expect(action).toContain("return false;"); // an unreachable config is closed, not open
  });

  it("the session provider makes no request without the presence hint", () => {
    const src = read("contexts/AuthContext.tsx");
    const hint = src.indexOf("hasAccountHint()");
    const sync = src.indexOf("await refreshUser()");
    expect(hint).toBeGreaterThan(-1);
    expect(hint).toBeLessThan(sync);
  });

  it("the session token only ever lives in an HttpOnly cookie written by a server action", () => {
    const session = read("lib/account/account-session.ts");
    expect(session).toMatch(/httpOnly:\s*true/);
    expect(session).toMatch(/sameSite:\s*"lax"/);
    // the only non-HttpOnly cookie is the value-`1` presence hint
    expect(session.match(/httpOnly:\s*false/g)?.length).toBe(1);
    expect(session).toContain('store.set(ACCOUNT_HINT_COOKIE, "1"');
    const actions = read("lib/data/customer.ts");
    expect(actions.startsWith('"use server"')).toBe(true);
    expect(actions).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("no client component imports the cookie/session module", () => {
    for (const file of walk(join(SRC, "components", "account"))) {
      const src = readFileSync(file, "utf8");
      if (!/^"use client"/.test(src)) continue;
      expect(src, relative(SRC, file)).not.toContain(
        "@/lib/account/account-session",
      );
    }
  });

  it("buyer-account UI has no runtime Spree import", () => {
    const files = [
      ...walk(join(SRC, "components", "account")),
      join(SRC, "contexts", "AuthContext.tsx"),
      ...walk(
        join(SRC, "app", "[country]", "[locale]", "(storefront)", "account"),
      ),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const rel = relative(SRC, file);
      // Cookie-presence helpers (getAccessToken / getRefreshToken) are fine;
      // the SDK client, session refresh and config are not.
      expect(src, rel).not.toMatch(
        /from\s+["']@\/lib\/spree\/(config|auth-helpers)/,
      );
      expect(src, rel).not.toMatch(
        /\b(getClient|getClientForSurface|withAuthRefresh|ensureFreshSession|initSpreeNext)\b/,
      );
      // type-only SDK imports (dead legacy views) are tolerated; values are not
      expect(src, rel).not.toMatch(
        /import\s+(?!type\b)[^;]*from\s+["']@spree\//,
      );
    }
  });

  it("no action returns an upstream message (no `error:` text field)", () => {
    const src = read("lib/data/customer.ts");
    expect(src).not.toMatch(/error\??:\s*string/);
    expect(src).not.toMatch(/error\.message/);
    expect(src).not.toContain("buyerSafeMessage");
  });

  it("the shopper-facing copy never mentions Spree or its environment", () => {
    for (const locale of ["ar", "en", "de", "es", "fr", "pl"]) {
      const messages = JSON.parse(
        readFileSync(join(SRC, "..", "messages", `${locale}.json`), "utf8"),
      ) as {
        accountGate: Record<string, string>;
        accountErrors: Record<string, string>;
      };
      expect(
        JSON.stringify([messages.accountGate, messages.accountErrors]),
        locale,
      ).not.toMatch(/spree|SPREE_|environment|configured/i);
    }
    const notice = read("components/account/AccountAuthUnavailable.tsx");
    expect(notice).not.toMatch(/SPREE_|process\.env/);
  });
});
