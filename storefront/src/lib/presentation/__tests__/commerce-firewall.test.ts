import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";

interface Fixture {
  forbiddenKeyPattern: string;
  allowedKeys: string[];
  forbiddenValues: string[];
  input: unknown;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/commerce-firewall.json",
    ),
    "utf8",
  ),
) as Fixture;

function keysOf(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) keysOf(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      out.add(key);
      keysOf(value, out);
    }
  }
  return out;
}

/**
 * CUST-HV V9d-4 (V0 §14.3) — the TS twin of PHP's `StorefrontCommerceFirewallTest`: a hostile document carrying commercial keys in every
 * presentation scope loses all of them in normalisation, and the legitimate parts survive.
 */
describe("commerce firewall — presentation normalisation", () => {
  const normalized = normalizePresentationConfig(fixture.input);

  it("control: the raw document does carry commercial keys (the scan can see them)", () => {
    const pattern = new RegExp(fixture.forbiddenKeyPattern, "i");
    const raw = [...keysOf(fixture.input)].filter((key) => pattern.test(key));
    expect(raw.length).toBeGreaterThanOrEqual(10);
  });

  it("the deny pattern matches value-bearing keys and never an allowed presentation control", () => {
    const pattern = new RegExp(fixture.forbiddenKeyPattern, "i");
    for (const key of fixture.allowedKeys)
      expect(pattern.test(key), key).toBe(false);
    for (const key of [
      "price",
      "salePrice",
      "stockCount",
      "shippingFee",
      "offerStatus",
      "grandTotal",
      "unitPrice",
      "taxAmount",
      "shippingCost",
      "checkoutTotal",
      "subtotal",
    ]) {
      expect(pattern.test(key), key).toBe(true);
    }
  });

  it("no commercial key survives in any scope", () => {
    const pattern = new RegExp(fixture.forbiddenKeyPattern, "i");
    const offending = [...keysOf(normalized)].filter((key) =>
      pattern.test(key),
    );
    expect(offending).toEqual([]);
  });

  it("no injected commercial value is reachable", () => {
    const json = JSON.stringify(normalized);
    for (const value of fixture.forbiddenValues) {
      expect(json).not.toContain(`"${value}"`);
    }
  });

  it("the legitimate parts of the document still normalise", () => {
    const sections = normalized.homepage.sections;
    expect(sections.map((s) => s.type)).toEqual([
      "newArrivals",
      "featured",
      "offers",
      "productShelf",
      "hero",
      "benefits",
      "customContent",
    ]);
    expect(sections[0].design?.cards).toEqual({
      align: "center",
      imageRatio: "1:1",
      imageFit: "contain",
      hover: "lift",
    });
    expect(sections[2].content).toEqual({ offerIds: ["o1"], showTitle: false });

    // every scope the hostile document carried is still produced (the firewall strips keys, not scopes)
    for (const scope of [
      "branding",
      "header",
      "footer",
      "contact",
      "whatsapp",
      "social",
      "verification",
      "sbc",
      "apps",
      "navigation",
      "pagePresentation",
      "announcements",
      "palette",
    ]) {
      expect(normalized, scope).toHaveProperty(scope);
    }

    // ...and the nested, accepted items inside the variable-shape scopes were really processed (not merely replaced by defaults)
    expect(normalized.social[0]?.network).toBe("x");
    expect(normalized.header.links[0]?.id).toBe("nav-home");
    expect(normalized.navigation?.menus[0]?.items.map((i) => i.id)).toEqual([
      "h",
      "e",
    ]);
    expect(normalized.footer.groups?.[0]?.links?.[0]?.id).toBe("a");
    expect(normalized.announcements?.items[0]?.id).toBe("a");
    expect(normalized.pagePresentation?.product?.regions[0]?.key).toBe("price");
  });
});
