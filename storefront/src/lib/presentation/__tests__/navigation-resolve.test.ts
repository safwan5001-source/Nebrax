import { describe, expect, it } from "vitest";
import { normalizeNavigation } from "../navigation";
import {
  collectNavTargetIds,
  MAX_NAV_PRODUCT_TARGETS,
  type NavResolveContext,
  navTargetHref,
  resolveFooterGroups,
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

describe("resolveFooterGroups (V7e-2)", () => {
  const link = (id: string, label: string, target: unknown) =>
    ({ id, label, target, enabled: true }) as never;
  const menus = [
    {
      id: "footer",
      name: "",
      items: [
        link("m1", "Privacy", { kind: "content", slug: "privacy-policy" }),
        link("m2", "Gone", { kind: "category", id: "zzz" }),
      ],
    },
  ] as never;

  it("a referenced menu wins over the group's own links, top-level only, dead items omitted", () => {
    const [g] = resolveFooterGroups(
      [
        {
          id: "g",
          title: "Info",
          menu: "footer",
          links: [link("x", "Ignored", { kind: "home" })],
        },
      ] as never,
      menus,
      ctx,
    );
    expect(g?.items.map((i) => i.label)).toEqual(["Privacy"]);
    expect(g?.span).toBe(1);
  });

  it("a missing menu degrades to the group's own links", () => {
    const [g] = resolveFooterGroups(
      [
        {
          id: "g",
          title: "Info",
          menu: "nope",
          span: 2,
          links: [link("x", "Home", { kind: "home" })],
        },
      ] as never,
      menus,
      ctx,
    );
    expect(g?.items.map((i) => i.label)).toEqual(["Home"]);
    expect(g?.span).toBe(2);
  });

  it("omits a group without a title or without a live link", () => {
    const out = resolveFooterGroups(
      [
        { id: "a", title: "  ", links: [link("x", "Home", { kind: "home" })] },
        { id: "b", title: "Empty" },
        {
          id: "c",
          title: "Dead",
          links: [link("y", "Gone", { kind: "product", id: "zzz" })],
        },
        {
          id: "d",
          title: "Ok",
          links: [link("z", "Shoes", { kind: "category", id: "c1" })],
        },
      ] as never,
      [],
      ctx,
    );
    expect(out.map((g) => g.id)).toEqual(["d"]);
  });

  it("children never reach a footer group; icons and badges survive", () => {
    const [g] = resolveFooterGroups(
      [
        {
          id: "g",
          title: "T",
          links: [
            {
              id: "x",
              label: "A",
              target: { kind: "home" },
              enabled: true,
              icon: "tag",
              badge: { text: "New" },
            },
          ],
        },
      ] as never,
      [],
      ctx,
    );
    expect(g?.items[0]).toEqual({
      id: "x",
      label: "A",
      href: "/sa/ar",
      newTab: false,
      icon: "tag",
      badge: { text: "New" },
    });
  });
});

describe("collectNavTargetIds across menus (V7e-2)", () => {
  it("shares the product cap across menus", () => {
    const mk = (n: number, prefix: string) =>
      ({
        id: prefix,
        name: "",
        items: Array.from({ length: n }, (_, i) => ({
          id: `${prefix}${i}`,
          label: "x",
          enabled: true,
          target: { kind: "product", id: `${prefix}-p${i}` },
        })),
      }) as never;
    const ids = collectNavTargetIds([mk(6, "a"), mk(6, "b")]);
    expect(ids.productIds).toHaveLength(MAX_NAV_PRODUCT_TARGETS);
  });
});

describe("policy targets honour the merchant-enabled pages (X4)", () => {
  const withPolicies = (slugs: string[]): NavResolveContext => ({
    ...ctx,
    policySlugs: new Set(slugs),
  });

  it("a policy that is not enabled is omitted — never a link to a 404", () => {
    const target = { kind: "content", slug: "privacy-policy" } as const;
    expect(navTargetHref(target, withPolicies(["privacy-policy"]))).toBe(
      "/sa/ar/policies/privacy-policy",
    );
    expect(
      navTargetHref(target, withPolicies(["terms-of-service"])),
    ).toBeNull();
    expect(navTargetHref(target, withPolicies([]))).toBeNull();
  });

  it("without the set the behaviour is unchanged, and the contact anchor is unaffected", () => {
    expect(
      navTargetHref({ kind: "content", slug: "privacy-policy" }, ctx),
    ).toBe("/sa/ar/policies/privacy-policy");
    expect(
      navTargetHref({ kind: "content", slug: "contact" }, withPolicies([])),
    ).toBe("/sa/ar/#contact");
  });

  it("an item pointing at a disabled policy drops out of the resolved menu", () => {
    const resolved = resolveNavMenu(
      menu([
        {
          id: "a",
          label: "Privacy",
          target: { kind: "content", slug: "privacy-policy" },
        },
        {
          id: "b",
          label: "Terms",
          target: { kind: "content", slug: "terms-of-service" },
        },
      ]),
      withPolicies(["terms-of-service"]),
    );
    expect(resolved.map((item) => item.href)).toEqual([
      "/sa/ar/policies/terms-of-service",
    ]);
  });
});
