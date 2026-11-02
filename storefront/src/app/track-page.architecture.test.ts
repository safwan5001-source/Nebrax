import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * COPS-H2-5 — structural guards for the guest tracking page: private to the link holder (no indexing, no Referer leak),
 * the token only from the path, no order reference / payment surface, and no direct API call from the browser.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("guest tracking page — architecture", () => {
  const layout = read("app/[country]/[locale]/(store-checkout)/track/[token]/layout.tsx");
  const page = read("app/[country]/[locale]/(store-checkout)/track/[token]/page.tsx");
  const view = read("components/orders/OrderTrackingView.tsx");
  const client = read("lib/commerce/order-tracking.ts");
  const actions = read("lib/data/awj-order-tracking.ts");

  it("is never indexed and never leaks the link through Referer", () => {
    expect(layout).toMatch(/index:\s*false/);
    expect(layout).toMatch(/follow:\s*false/);
    expect(layout).toContain("strict-origin-when-cross-origin");
  });

  it("reads the token from the path only (no query string, no storage)", () => {
    expect(page).toContain("useParams");
    for (const source of [page, view]) {
      expect(source).not.toMatch(/useSearchParams|location\.search|localStorage|sessionStorage|document\.cookie/);
    }
  });

  it("never touches the order reference or any payment surface", () => {
    for (const source of [page, view]) {
      expect(source).not.toMatch(/orderReference|X-Order-Reference|payment-intent|payment-status|startOnlinePayment/);
    }
  });

  it("calls the API only from server code (actions/lib), never fetch in the component or page", () => {
    expect(view).not.toMatch(/\bfetch\(|storefrontFetch|storefrontCartRequest/);
    expect(page).not.toMatch(/\bfetch\(/);
    expect(actions.startsWith('"use server"')).toBe(true);
    expect(client).toContain('cache: "no-store"');
  });
});
