import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * H6 Batch G architecture guards for the native wholesale buyer surface.
 * Source-scanning, like the existing AwjCheckoutFlow / Account architecture
 * tests: they pin boundaries a unit test of behaviour would not notice.
 */
const SRC = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(join(SRC, relative), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** An actual `"use cache…"` directive statement, not a comment that mentions one. */
const CACHE_DIRECTIVE = /^\s*["']use cache[^"'\n]*["'];?\s*$/m;

const NEW_FILES = [
  "lib/commerce/wholesale-buyer.ts",
  "lib/commerce/buyer-session.ts",
  "lib/data/wholesale-buyer.ts",
  "components/wholesale-buyer/BuyerSignInForm.tsx",
  "components/wholesale-buyer/BuyerMembershipPanel.tsx",
  "components/wholesale-buyer/CatalogAccessGate.tsx",
  "components/wholesale-buyer/BuyerRegisterForm.tsx",
  "components/wholesale-buyer/BuyerResendForm.tsx",
  "components/wholesale-buyer/BuyerVerifyEmail.tsx",
  "app/[country]/[locale]/(storefront)/buyer/register/page.tsx",
  "app/[country]/[locale]/(storefront)/buyer/resend/page.tsx",
  "app/[country]/[locale]/(storefront)/buyer/verify/page.tsx",
  "app/[country]/[locale]/(storefront)/buyer/sign-in/page.tsx",
  "app/[country]/[locale]/(storefront)/buyer/membership/page.tsx",
];

describe("native wholesale buyer surface — boundaries", () => {
  it("adds no Spree dependency", () => {
    for (const file of NEW_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/@spree\/|@\/lib\/spree|lib\/spree/);
      expect(source, file).not.toMatch(/SPREE_/);
    }
  });

  it("does not reuse the legacy Spree-group wholesale portal", () => {
    for (const file of NEW_FILES) {
      expect(read(file), file).not.toMatch(
        /lib\/data\/wholesale["']|isWholesaleApproved|WHOLESALE_GROUP_NAME|data\/wholesale"/,
      );
    }
  });

  it("the session token is server-only: no client component imports the session module or the transport", () => {
    for (const file of NEW_FILES) {
      const source = read(file);
      if (!source.startsWith('"use client"')) continue;
      expect(source, file).not.toMatch(
        /buyer-session|commerce\/config|next\/headers/,
      );
    }
    // the only things a client component may call are the server actions
    expect(read("components/wholesale-buyer/BuyerSignInForm.tsx")).toContain(
      "@/lib/data/wholesale-buyer",
    );
  });

  it("server actions never return the token", () => {
    const source = read("lib/data/wholesale-buyer.ts");
    expect(source.startsWith('"use server"')).toBe(true);
    expect(source).not.toMatch(/return\s*\{[^}]*token/);
  });

  it("the buyer token reaches cart, checkout and payment ONLY through the shared server transport (H6 Batch K)", () => {
    // Batch G forbade forwarding to cart/checkout until the backend contract (approved precedence, membership re-check,
    // order ownership) existed. Batches H–J delivered it, so Batch K forwards the HttpOnly-cookie token — but through
    // exactly ONE place: `storefrontCartRequest` in `config.ts`. No feature module touches the token, so no call site
    // can forget, leak or log it.
    const importers = walk(join(SRC))
      .filter((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f))
      .filter((f) => /getBuyerToken/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(importers).toEqual([
      "lib/commerce/buyer-session.ts",
      "lib/commerce/config.ts",
      "lib/data/wholesale-buyer.ts",
    ]);

    // …and it is only ever placed in a request HEADER: never a URL, body, log, storage or a returned value
    const transport = read("lib/commerce/config.ts");
    expect(transport).toMatch(
      /requestHeaders\[BUYER_TOKEN_HEADER\]\s*=\s*buyerToken/,
    );
    expect(transport).not.toMatch(
      /console\.(log|info|warn|error)\([^)]*(buyerToken|token)/,
    );
    expect(transport).not.toMatch(
      /searchParams\.(set|append)\([^)]*buyerToken/,
    );
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /(localStorage|sessionStorage)\.[a-zA-Z]+\([^)]*awj_buyer_session/,
      );
    }
  });

  it("the buyer token rides on catalogue reads only via withBuyerToken, and no feature module references it directly", () => {
    const withToken = walk(join(SRC, "lib")).filter((f) =>
      readFileSync(f, "utf8").includes("withBuyerToken"),
    );
    const names = withToken.map((f) => f.slice(SRC.length + 1)).sort();
    expect(names).toEqual([
      "lib/commerce/buyer-session.ts",
      "lib/commerce/data-sections.ts",
      "lib/commerce/offers.ts",
      "lib/commerce/products.ts",
    ]);

    for (const file of [
      "lib/commerce/cart.ts",
      "lib/commerce/checkout.ts",
      "lib/commerce/online-payment.ts",
      "lib/data/cart.ts",
      "lib/data/checkout.ts",
      "lib/data/orders.ts",
      "lib/data/payment.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /buyer-session|buyerToken|X-Customer-Token|BUYER_TOKEN_HEADER/,
      );
    }
  });

  it("no priced catalogue/offer/cart/checkout module sits behind a shared cache", () => {
    for (const file of [
      "lib/commerce/products.ts",
      "lib/commerce/offers.ts",
      "lib/commerce/data-sections.ts",
      "lib/commerce/cart.ts",
      "lib/commerce/checkout.ts",
      "lib/data/products.ts",
      "lib/data/cart.ts",
      "lib/data/checkout.ts",
      "lib/commerce/buyer-session.ts",
      "lib/data/wholesale-buyer.ts",
    ]) {
      expect(read(file), file).not.toMatch(CACHE_DIRECTIVE);
    }
    // and nothing that imports the priced fetchers is itself a cached function
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      if (
        CACHE_DIRECTIVE.test(source) &&
        /commerce\/(products|offers|cart|checkout)["']/.test(source)
      ) {
        throw new Error(`${file} caches a module that returns prices`);
      }
    }
  });

  it("every wholesaleBuyer message key exists in all six locales", () => {
    const base = JSON.parse(
      read("../messages/en.json").replace(/^﻿/, ""),
    ) as Record<string, unknown>;
    expect(base.wholesaleBuyer).toBeTruthy();
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v !== null
          ? keys(v, `${p}${k}.`)
          : [`${p}${k}`],
      );
    const expected = keys(base.wholesaleBuyer).sort();
    for (const locale of ["ar", "de", "es", "fr", "pl"]) {
      const messages = JSON.parse(read(`../messages/${locale}.json`)) as Record<
        string,
        unknown
      >;
      expect(keys(messages.wholesaleBuyer).sort(), locale).toEqual(expected);
    }
    // every state the UI can show has copy
    for (const key of [
      "register.doneBody",
      "verify.successBody",
      "verify.failedBody",
      "verify.missingToken",
      "resend.doneBody",
      "errors.validation",
      "signIn.registerLink",
      "signIn.resendLink",
    ]) {
      expect(expected).toContain(key);
    }
    for (const state of [
      "signed_out",
      "no_application",
      "pending",
      "approved",
      "rejected",
      "suspended",
      "unavailable",
    ]) {
      expect(expected).toContain(`status.${state}.label`);
      expect(expected).toContain(`status.${state}.body`);
    }
  });

  it("the e-mailed token is never consumed during a server render (only by an explicit client action)", () => {
    const page = read(
      "app/[country]/[locale]/(storefront)/buyer/verify/page.tsx",
    );
    expect(page).not.toMatch(/verifyBuyerEmail|@\/lib\/data\/wholesale-buyer/);
    expect(page).toMatch(/\^\[A-Za-z0-9\]\{64\}\$/);
    expect(read("components/wholesale-buyer/BuyerVerifyEmail.tsx")).toMatch(
      /onClick=\{confirm\}/,
    );
  });
});
