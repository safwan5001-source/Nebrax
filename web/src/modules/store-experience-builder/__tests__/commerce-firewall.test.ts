import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../presentation/config";

interface Fixture {
  commerceWords: string[];
  presentationSuffixes: string[];
  selectorKeys: string[];
  deniedKeys: string[];
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

/** The deny rule shared with the PHP suite (see the fixture note): denied when any word is a commerce word and the LAST word is not a presentation suffix. */
function denies(key: string): boolean {
  if (fixture.selectorKeys.includes(key)) return false;
  const words = key
    .split(/[\s_-]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return (
    words.some((word) => fixture.commerceWords.includes(word)) &&
    !fixture.presentationSuffixes.includes(words[words.length - 1])
  );
}

/** Keys that contain a commerce word and carry a number: presentation controls are bounded string enums, never numeric (V0 §14.3). */
function numericCommerceKeys(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) numericCommerceKeys(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const words = key
        .split(/[\s_-]+|(?<=[a-z0-9])(?=[A-Z])/)
        .filter(Boolean)
        .map((word) => word.toLowerCase());
      const numeric =
        typeof value === "number" ||
        (Array.isArray(value) && value.some((item) => typeof item === "number"));
      if (numeric && words.some((word) => fixture.commerceWords.includes(word))) out.push(key);
      numericCommerceKeys(value, out);
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
    const raw = [...keysOf(fixture.input)].filter(denies);
    expect(raw.length).toBeGreaterThanOrEqual(10);
  });

  it("the deny rule rejects value-bearing, scaling and hiding keys and never an allowed presentation control", () => {
    for (const key of fixture.allowedKeys) expect(denies(key), key).toBe(false);
    for (const key of fixture.deniedKeys) expect(denies(key), key).toBe(true);
  });

  it("no commercial key survives in any scope", () => {
    const offending = [...keysOf(normalized)].filter(denies);
    expect(offending).toEqual([]);
    expect(numericCommerceKeys(normalized)).toEqual([]);
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
      "categories",
      "wholesale",
      "banner",
      "appPromo",
      "discovery",
      "deliveryPromise",
      "slider",
      "gallery",
    ]);
    // the distinct normalisation branches really processed their (hostile) content rather than dropping it
    const content = (type: string) =>
      sections.find((s) => s.type === type)?.content as never as Record<string, any>;
    expect(content("banner").title).toBe("خصم الصيف");
    expect(content("discovery").dimension).toBe("color");
    expect(content("deliveryPromise").body).toBe("نوصل اليوم");
    expect(content("slider").slides[0].id).toBe("sl1");
    expect(content("gallery").images[0].id).toBe("g1");
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
    // the hostile document tried to HIDE the required price region (`visible: false`): presentation data cannot hide authoritative price
    expect(normalized.pagePresentation?.product?.regions[0]?.visible).toBe(true);
    // ...and the category document's required product grid (a separate branch) is forced visible too
    expect(normalized.pagePresentation?.category?.regions[0]?.key).toBe("product_grid");
    expect(normalized.pagePresentation?.category?.regions[0]?.visible).toBe(true);
  });
});
