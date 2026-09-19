import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ADDRESSES_CAPABILITY,
  ACCOUNT_ORDER_HISTORY_CAPABILITY,
  ACCOUNT_ORDER_LOOKUP_CAPABILITY,
  ACCOUNT_ORDER_STATUS_CAPABILITY,
  ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY,
  WISHLIST_CAPABILITY,
} from "@/lib/commerce/capabilities";

/**
 * Structural guards for the AWJ customer account, not DOM assertions:
 *
 * 1. AWJ DTC account UI must never import the Spree SDK or Spree order
 *    data layer — CommerceOrder is the authority, and Spree payment /
 *    fulfilment vocabulary is not AWJ order truth.
 * 2. No hardcoded physical-direction Tailwind.
 * 3. No payment-provider name or brand mark.
 * 4. Saved-payment surface collects no card data.
 * 5. DESIGN_ONLY actions do not report fake success.
 * 6. CommerceOrder is never titled an invoice.
 */

const ACCOUNT_DIR = join(__dirname, "..");
const PHYSICAL_DIRECTION_CLASS = /\b(ml|mr|pl|pr)-\d|text-(left|right)\b/;
const PAYMENT_BRANDS =
  /\b(stripe|adyen|paypal|checkout\.com|hyperpay|moyasar|tap ?payments?|tabby|tamara|mada|visa|mastercard|amex|american express|apple ?pay|google ?pay|stc ?pay|klarna)\b/i;
const INVOICE_CLAIM = /\b(Download Invoice|Tax Invoice|فاتورة|إيصال)\b/;
const FAKE_SUCCESS =
  /\b(saved successfully|address saved|card saved|payment method saved|تم الحفظ)\b/i;

function accountFiles(): string[] {
  return readdirSync(ACCOUNT_DIR)
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
    .map((name) => join(ACCOUNT_DIR, name));
}

function sources(): Array<{ path: string; source: string }> {
  return accountFiles().map((path) => ({
    path,
    source: readFileSync(path, "utf-8"),
  }));
}

const AWJ_ACCOUNT_FILES = [
  "AccountShell.tsx",
  "AccountOverview.tsx",
  "AccountSignIn.tsx",
  "AccountOrderList.tsx",
  "AccountOrderDetail.tsx",
  "AccountOrderStatus.tsx",
  "AccountAddresses.tsx",
  "AccountPaymentMethods.tsx",
  "AccountWishlist.tsx",
  "AccountProfileForm.tsx",
  "AccountGatedNotice.tsx",
  "AccountEmptyState.tsx",
  "AccountAuthCard.tsx",
  "account-nav.ts",
];

describe("AWJ account — architecture boundaries", () => {
  it("declares the STORE-UI-5 capabilities as design_only", () => {
    expect(ACCOUNT_ORDER_HISTORY_CAPABILITY).toBe("design_only");
    expect(ACCOUNT_ORDER_LOOKUP_CAPABILITY).toBe("design_only");
    expect(ACCOUNT_ORDER_STATUS_CAPABILITY).toBe("design_only");
    expect(ACCOUNT_ADDRESSES_CAPABILITY).toBe("design_only");
    expect(ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY).toBe("design_only");
    expect(WISHLIST_CAPABILITY).toBe("design_only");
  });

  it("covers the new AWJ account files", () => {
    const names = readdirSync(ACCOUNT_DIR);
    for (const file of AWJ_ACCOUNT_FILES) {
      expect(names).toContain(file);
    }
  });

  it("never imports the Spree SDK or Spree order/address/card data layers in AWJ account UI", () => {
    for (const file of AWJ_ACCOUNT_FILES) {
      const source = readFileSync(join(ACCOUNT_DIR, file), "utf-8");
      const importLines = source
        .split("\n")
        .filter((line) => /^import\b/.test(line.trim()));

      for (const line of importLines) {
        expect(line, file).not.toMatch(/["']@spree\/sdk["']/);
        expect(line, file).not.toMatch(/["']@\/lib\/data\/orders["']/);
        expect(line, file).not.toMatch(/["']@\/lib\/data\/addresses["']/);
        expect(line, file).not.toMatch(/["']@\/lib\/data\/credit-cards["']/);
      }
    }
  });

  it("uses no hardcoded physical-direction Tailwind classes", () => {
    for (const { path, source } of sources()) {
      if (
        path.endsWith("OrderList.tsx") ||
        path.endsWith("OrderDetail.tsx") ||
        path.endsWith("CreditCardList.tsx") ||
        path.endsWith("GiftCardList.tsx")
      ) {
        continue;
      }
      const offendingLines = source
        .split("\n")
        .filter((line) => PHYSICAL_DIRECTION_CLASS.test(line));
      expect(offendingLines, path).toEqual([]);
    }
  });

  it("names no payment provider or card scheme anywhere in the account UI", () => {
    for (const { path, source } of sources()) {
      if (
        path.endsWith("CreditCardList.tsx") ||
        path.endsWith("GiftCardList.tsx")
      ) {
        continue;
      }
      expect(source, path).not.toMatch(PAYMENT_BRANDS);
    }
  });

  it("the saved-payment surface collects no card data", () => {
    const stage = readFileSync(
      join(ACCOUNT_DIR, "AccountPaymentMethods.tsx"),
      "utf-8",
    );
    expect(stage).not.toMatch(/<Input\b/);
    expect(stage).not.toMatch(/<input\b/);
    expect(stage).not.toMatch(/\bcc-(number|exp|csc)\b/);
  });

  it("never titles a CommerceOrder an invoice or offers a receipt download", () => {
    for (const file of [
      "AccountOrderList.tsx",
      "AccountOrderDetail.tsx",
      "AccountOrderStatus.tsx",
    ]) {
      const source = readFileSync(join(ACCOUNT_DIR, file), "utf-8");
      expect(source, file).not.toMatch(INVOICE_CLAIM);
    }
  });

  it("DESIGN_ONLY address and payment actions do not report fake success", () => {
    for (const file of ["AccountAddresses.tsx", "AccountPaymentMethods.tsx"]) {
      const source = readFileSync(join(ACCOUNT_DIR, file), "utf-8");
      expect(source, file).not.toMatch(FAKE_SUCCESS);
    }
  });

  it("does not substitute browser storage for account persistence", () => {
    for (const file of AWJ_ACCOUNT_FILES) {
      const source = readFileSync(join(ACCOUNT_DIR, file), "utf-8");
      expect(source, file).not.toMatch(/\blocalStorage\b/);
      expect(source, file).not.toMatch(/\bsessionStorage\b/);
    }
  });
});
