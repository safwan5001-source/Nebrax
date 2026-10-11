import { describe, expect, it } from "vitest";
import { normalizeNavigation } from "../navigation";
import {
  collectNavTargetIds,
  MAX_NAV_PRODUCT_TARGETS,
  type NavResolveContext,
  navTargetHref,
  resolveNavMenu,
} from "../navigation-resolve";

const ctx: NavResolveContext = {
  basePath: "/sa/ar",
  categories: new Map([["c1", "shoes"]]),
  products: new Set(["p1"]),
};

function menu(items: unknown[]) {
  const doc = normalizeNavigation({ menus: [{ id: "main", items }] });
  if (!doc) throw new Error("fixture rejected");
  return doc.menus[0] as NonNullable<typeof doc>["menus"][number];
}

describe("navTargetHref (V7d-3)", () => {
  it("resolves each typed target against the live catalogue", () => {
    expect(navTargetHref({ kind: "home" }, ctx)).toBe("/sa/ar");
    expect(navTargetHref({ kind: "category", id: "c1" }, ctx)).toBe(
      "/sa/ar/c/shoes",
    );
    expect(navTargetHref({ kind: "product", id: "p1" }, ctx)).toBe(
      "/sa/ar/products/p1",
    );
    expect(
      navTargetHref({ kind: "content", slug: "privacy-policy" }, ctx),
    ).toBe("/sa/ar/policies/privacy-policy");
    expect(navTargetHref({ kind: "content", slug: "contact" }, ctx)).toBe(
      "/sa/ar/#contact",
    );
    expect(
      navTargetHref({ kind: "external", href: "https://example.com/x" }, ctx),
    ).toBe("https://example.com/x");
  });

  it("a deleted category / product is null — never a dead link", () => {
    expect(navTargetHref({ kind: "category", id: "gone" }, ctx)).toBeNull();
    expect(navTargetHref({ kind: "product", id: "gone" }, ctx)).toBeNull();
  });

  it("a content page the storefront does not serve is null, not a 404", () => {
    expect(navTargetHref({ kind: "content", slug: "about" }, ctx)).toBeNull();
    expect(navTargetHref({ kind: "content", slug: "faq" }, ctx)).toBeNull();
  });

  it("home with no base path is /", () => {
    expect(navTargetHref({ kind: "home" }, { ...ctx, basePath: "" })).toBe("/");
  });
});

describe("resolveNavMenu (V7d-3)", () => {
  it("omits disabled, label-less and unresolvable items, keeping the order", () => {
    const out = resolveNavMenu(
      menu([
        { id: "a", label: "Home", target: { kind: "home" } },
        { id: "b", label: "Off", target: { kind: "home" }, enabled: false },
        { id: "c", label: "  ", target: { kind: "home" } },
        { id: "d", label: "Gone", target: { kind: "category", id: "zzz" } },
        { id: "e", label: "Shoes", target: { kind: "category", id: "c1" } },
      ]),
      ctx,
    );
    expect(out.map((i) => i.id)).toEqual(["a", "e"]);
  });

  it("carries newTab only for external targets, plus icon and badge", () => {
    const [ext, home] = resolveNavMenu(
      menu([
        {
          id: "x",
          label: "Blog",
          target: {
            kind: "external",
            href: "https://example.com",
            newTab: true,
          },
          icon: "globe",
          badge: { text: "New", tone: "accent" },
        },
        { id: "h", label: "Home", target: { kind: "home" } },
      ]),
      ctx,
    );
    expect(ext).toMatchObject({
      newTab: true,
      icon: "globe",
      badge: { text: "New", tone: "accent" },
    });
    expect(home?.newTab).toBe(false);
  });

  it("a dropdown needs at least one live child; dead children are dropped", () => {
    const [withKids, deadKids] = resolveNavMenu(
      menu([
        {
          id: "shop",
          label: "Shop",
          target: { kind: "home" },
          presentation: { kind: "dropdown" },
          children: [
            {
              id: "k1",
              label: "Shoes",
              target: { kind: "category", id: "c1" },
            },
            {
              id: "k2",
              label: "Gone",
              target: { kind: "category", id: "zzz" },
            },
          ],
        },
        {
          id: "lonely",
          label: "Lonely",
          target: { kind: "home" },
          presentation: { kind: "dropdown" },
          children: [
            {
              id: "k3",
              label: "Gone",
              target: { kind: "product", id: "nope" },
            },
          ],
        },
      ]),
      ctx,
    );
    expect(withKids).toMatchObject({ dropdown: true });
    expect(withKids?.children.map((c) => c.id)).toEqual(["k1"]);
    expect(deadKids).toMatchObject({ dropdown: false, children: [] });
  });

  it("a link-presentation parent keeps its children as data but is not a dropdown", () => {
    const [item] = resolveNavMenu(
      menu([
        {
          id: "p",
          label: "P",
          target: { kind: "home" },
          children: [{ id: "k", label: "K", target: { kind: "home" } }],
        },
      ]),
      ctx,
    );
    expect(item?.dropdown).toBe(false);
  });
});

describe("collectNavTargetIds (V7d-3)", () => {
  it("collects enabled category / product ids once, products capped", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      target: { kind: "product", id: `prod-${i}` },
    }));
    const m = menu([
      ...items,
      {
        id: "c",
        label: "C",
        target: { kind: "category", id: "c1" },
        children: [
          { id: "c2", label: "C2", target: { kind: "category", id: "c1" } },
        ],
      },
      {
        id: "off",
        label: "Off",
        enabled: false,
        target: { kind: "category", id: "hidden" },
      },
    ]);
    const ids = collectNavTargetIds(m);
    expect(ids.categoryIds).toEqual(["c1"]);
    expect(ids.productIds).toHaveLength(MAX_NAV_PRODUCT_TARGETS);
  });
});
