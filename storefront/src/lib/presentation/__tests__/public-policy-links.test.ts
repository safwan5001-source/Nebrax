import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/commerce/categories", () => ({ fetchCategories: vi.fn() }));
vi.mock("@/lib/commerce/products", () => ({ fetchProductsByIds: vi.fn() }));

import { readPolicyAvailability } from "@/lib/policy/availability";
import { readPublishedPresentation } from "../public";
import { publishedFooterGroups } from "../public-footer";
import { publishedMainNav } from "../public-navigation";

const link = (id: string, label: string, slug: string) => ({
  id,
  label,
  target: { kind: "content", slug },
  enabled: true,
});

const page = (slug: string, enabled = true) => ({
  id: `p-${slug}`,
  slug,
  title: "",
  enabled,
});

const published = readPublishedPresentation({
  pages: [
    page("privacy-policy"),
    page("returns-policy"),
    page("terms-of-service", false),
  ],
  navigation: {
    menus: [
      {
        id: "main",
        items: [
          link("a", "Privacy", "privacy-policy"),
          link("b", "Returns", "returns-policy"),
          link("c", "Terms", "terms-of-service"),
        ],
      },
      {
        id: "footer",
        items: [
          link("d", "Privacy", "privacy-policy"),
          link("e", "Returns", "returns-policy"),
        ],
      },
    ],
  },
  footer: { groups: [{ id: "g", title: "Info", menu: "footer" }] },
});

const none = readPolicyAvailability(null);
const privacyOnly = readPolicyAvailability({ "privacy-policy": true });
const everything = readPolicyAvailability({
  "privacy-policy": true,
  "returns-policy": true,
  "terms-of-service": true,
});

describe("merchant menus honour policy availability (X4-FIX)", () => {
  it("main navigation keeps only enabled AND available policy targets", async () => {
    const hrefs = async (availability: typeof none) =>
      (await publishedMainNav(published, "/sa/ar", availability))?.map(
        (item) => item.href,
      );

    expect(await hrefs(privacyOnly)).toEqual([
      "/sa/ar/policies/privacy-policy",
    ]);
    // available content on a disabled page (terms) and an unavailable enabled page (returns) are both omitted
    expect(await hrefs(everything)).toEqual([
      "/sa/ar/policies/privacy-policy",
      "/sa/ar/policies/returns-policy",
    ]);
    expect(await hrefs(none)).toEqual([]);
  });

  it("footer link groups drop unavailable policy targets and fail closed without the signal", async () => {
    const hrefs = async (availability: typeof none) =>
      (await publishedFooterGroups(published, "/sa/ar", availability))?.flatMap(
        (group) => group.items.map((item) => item.href),
      );

    expect(await hrefs(privacyOnly)).toEqual([
      "/sa/ar/policies/privacy-policy",
    ]);
    expect(await hrefs(none)).toEqual([]);
  });
});
