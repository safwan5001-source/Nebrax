import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryValues } from "@/lib/commerce/data-sections";
import type { ListingFacetImageSource } from "@/lib/commerce/listing-facets";
import { DISCOVERY_TEMPLATE_IDS } from "@/lib/presentation/discovery-templates";
import { contrastRatio } from "@/lib/presentation/facet-visual-style";
import type { DiscoveryContent } from "@/lib/presentation/section-content";

/**
 * AWJ-VD-H1 / VD-4b — the discovery section's visual renderer.
 *
 * The legacy goldens below were produced by rendering the pre-VD-4b `DiscoverySection` (origin/main a37d893) with
 * these exact inputs; the same run asserted the new component equal to it, so they prove "legacy documents render
 * exactly as before" byte for byte.
 */

const mocks = vi.hoisted(() => ({ fetchDiscoveryValues: vi.fn() }));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key}|${Object.values(values).join("|")}` : key,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/commerce/data-sections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commerce/data-sections")>()),
  fetchDiscoveryValues: mocks.fetchDiscoveryValues,
}));

const { DiscoverySection } = await import("../DiscoverySection");

const base = { basePath: "/sa/ar", locale: "ar", headingId: "disc-a" };
const BRAND = "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6e";
const M1 = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const V1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const sources = (mediaId = M1): ListingFacetImageSource[] =>
  ["thumb-160", "thumb-320", "480w"].flatMap((file, i) =>
    (["webp", "jpg"] as const).map((format) => ({
      width: [160, 320, 480][i],
      format,
      src: `/api/storefront/media/facet-visuals/${V1}/${mediaId}/${file}.${format}`,
    })),
  );

const content = (over: Partial<DiscoveryContent> = {}): DiscoveryContent => ({
  title: "",
  axis: "facet",
  dimension: "occasion",
  display: "tiles",
  ...over,
});

async function renderSection(
  values: DiscoveryValues | null,
  over: Partial<DiscoveryContent> = {},
  props: Partial<typeof base> = {},
) {
  mocks.fetchDiscoveryValues.mockResolvedValue(values);
  const element = (await DiscoverySection({
    ...base,
    ...props,
    content: content(over),
  })) as React.JSX.Element | null;
  return element;
}

const plainFacet: DiscoveryValues = {
  name: "المناسبة",
  options: [
    { value: "eid", name: "العيد", count: 4 },
    { value: "mothers-day", name: "عيد الأم & الهدايا", count: 2 },
    { value: "valentine", name: "Valentine's <day>", count: 1 },
  ],
};

const visualFacet: DiscoveryValues = {
  name: "المناسبة",
  options: [
    {
      value: "eid",
      name: "العيد",
      count: 40,
      visual: { image: { mediaId: M1, fit: "cover" } },
      imageSources: sources(),
    },
    {
      value: "birthday",
      name: "عيد ميلاد",
      count: 9,
      visual: { icon: "gift" },
    },
    { value: "plain", name: "بلا هوية", count: 3 },
    {
      value: "long",
      name: "هدية تقدير وامتنان لأعز الأصدقاء والزملاء في مناسبة التخرج الجامعي الكبرى",
      count: 2,
    },
  ],
};

beforeEach(() => {
  mocks.fetchDiscoveryValues.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ───────────────────────────── legacy, byte for byte ─────────────────────────────

const A_TILE =
  'class="flex min-h-20 items-center justify-center rounded-store border border-store-border bg-store-surface px-3 py-4 text-center text-sm font-bold text-store-foreground transition-colors hover:border-store-primary hover:text-store-primary md:text-base"';
const A_CHIP =
  'class="inline-flex min-h-11 items-center rounded-full border border-store-border bg-store-surface px-4 text-sm font-bold text-store-foreground transition-colors hover:border-store-primary hover:text-store-primary"';
const H2 = 'class="text-base font-extrabold text-store-foreground md:text-lg"';

const LEGACY_TILES = `<section aria-labelledby="disc-a"><h2 id="disc-a" ${H2}>discoverBy المناسبة</h2><ul class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:gap-4"><li class="min-w-0"><a href="/sa/ar/products?facet%5Boccasion%5D=eid" ${A_TILE}><span class="min-w-0 break-words">العيد</span></a></li><li class="min-w-0"><a href="/sa/ar/products?facet%5Boccasion%5D=mothers-day" ${A_TILE}><span class="min-w-0 break-words">عيد الأم &amp; الهدايا</span></a></li><li class="min-w-0"><a href="/sa/ar/products?facet%5Boccasion%5D=valentine" ${A_TILE}><span class="min-w-0 break-words">Valentine&#x27;s &lt;day&gt;</span></a></li></ul></section>`;

const LEGACY_CHIPS = `<section aria-labelledby="disc-a"><h2 id="disc-a" ${H2}>تسوّق حسب المناسبة</h2><ul class="mt-4 flex flex-wrap gap-2"><li><a href="/sa/ar/products?facet%5Boccasion%5D=eid" ${A_CHIP}>العيد</a></li><li><a href="/sa/ar/products?facet%5Boccasion%5D=mothers-day" ${A_CHIP}>عيد الأم &amp; الهدايا</a></li><li><a href="/sa/ar/products?facet%5Boccasion%5D=valentine" ${A_CHIP}>Valentine&#x27;s &lt;day&gt;</a></li></ul></section>`;

const LEGACY_BRAND = `<section aria-labelledby="disc-a"><h2 id="disc-a" ${H2}>shopByBrand</h2><ul class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:gap-4"><li class="min-w-0"><a href="/sa/ar/products?brand_id=${BRAND}" ${A_TILE}><span class="min-w-0 break-words">علامة</span></a></li></ul></section>`;

describe("legacy documents (no layout, no template) render exactly as before", () => {
  it("tiles: byte-identical markup", async () => {
    const el = await renderSection(plainFacet);
    expect(renderToStaticMarkup(el as React.JSX.Element)).toBe(LEGACY_TILES);
  });

  it("chips with a merchant title: byte-identical markup", async () => {
    const el = await renderSection(plainFacet, {
      display: "chips",
      title: "تسوّق حسب المناسبة",
    });
    expect(renderToStaticMarkup(el as React.JSX.Element)).toBe(LEGACY_CHIPS);
  });

  it("brand tiles: byte-identical markup", async () => {
    const el = await renderSection(
      {
        name: "",
        options: [{ value: BRAND, name: "علامة", count: 3 }],
      },
      { axis: "brand", dimension: undefined },
    );
    expect(renderToStaticMarkup(el as React.JSX.Element)).toBe(LEGACY_BRAND);
  });

  it("ignores visuals the API sent: a legacy tile never draws an image", async () => {
    const el = await renderSection(visualFacet);
    const html = renderToStaticMarkup(el as React.JSX.Element);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("data-discovery-layout");
  });

  it("keeps the legacy cap of 12 and the API's order", async () => {
    const many: DiscoveryValues = {
      name: "المناسبة",
      options: Array.from({ length: 20 }, (_, i) => ({
        value: `v${i}`,
        name: `قيمة ${i}`,
        count: i + 1,
      })),
    };
    const el = await renderSection(many);
    render(el as React.JSX.Element);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(12);
    expect(links[0].textContent).toBe("قيمة 0");
    expect(links[11].textContent).toBe("قيمة 11");
  });

  it("a legacy document that only sets valueSort/maxItems honours them (generic options, legacy markup)", async () => {
    const many: DiscoveryValues = {
      name: "x",
      options: Array.from({ length: 10 }, (_, i) => ({
        value: `v${i}`,
        name: `n${i}`,
        count: i,
      })),
    };
    const el = await renderSection(many, { valueSort: "count", maxItems: 4 });
    render(el as React.JSX.Element);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "n9",
      "n8",
      "n7",
      "n6",
    ]);
    expect(document.querySelector("[data-discovery-layout]")).toBeNull();
  });
});

// ───────────────────────────── the five layouts ─────────────────────────────

describe("layouts: structure, real links, accessible names", () => {
  const LAYOUTS = [
    "image-grid",
    "image-cards",
    "carousel",
    "icon-grid",
    "text-list",
  ] as const;

  it.each(
    LAYOUTS,
  )("%s: a labelled section with one real link per value", async (layout) => {
    const el = await renderSection(visualFacet, { layout });
    render(el as React.JSX.Element);
    const section = screen.getByRole("heading").closest("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("disc-a");
    expect(screen.getByRole("heading").textContent).toBe("discoverBy المناسبة");
    const list = document.querySelector("[data-discovery-layout]");
    expect(list?.getAttribute("data-discovery-layout")).toBe(layout);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    const url = new URL(
      screen
        .getByRole("link", { name: "العيد" })
        .getAttribute("href") as string,
      "https://x.test",
    );
    expect(url.pathname).toBe("/sa/ar/products");
    expect(url.searchParams.get("facet[occasion]")).toBe("eid");
    expect(
      links
        .map((a) => a.getAttribute("href"))
        .every((h) => h?.startsWith("/sa/ar/products?facet%5Boccasion%5D=")),
    ).toBe(true);
  });

  it.each(
    LAYOUTS,
  )("%s: links meet the 44px target and show a visible focus ring", async (layout) => {
    const el = await renderSection(visualFacet, { layout });
    render(el as React.JSX.Element);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("focus-visible:outline-2");
    }
  });

  it("media layouts draw decorative, lazy, pre-sized images with a real srcset", async () => {
    const el = await renderSection(visualFacet, { layout: "image-grid" });
    const { container } = render(el as React.JSX.Element);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("width")).toBe("80");
    expect(img.getAttribute("height")).toBe("80");
    expect(img.getAttribute("srcset")).toBe(
      `/api/storefront/media/facet-visuals/${V1}/${M1}/thumb-160.webp 160w, /api/storefront/media/facet-visuals/${V1}/${M1}/thumb-320.webp 320w, /api/storefront/media/facet-visuals/${V1}/${M1}/480w.webp 480w`,
    );
    expect(img.getAttribute("sizes")).toBe("80px");
    expect(img.src).toContain("/api/storefront/media/facet-visuals/");
    expect(img.src).not.toContain("/store/v1/");
  });

  it("text-list draws no media and keeps the value name as the whole link", async () => {
    const el = await renderSection(visualFacet, { layout: "text-list" });
    const { container } = render(el as React.JSX.Element);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("link", { name: "عيد ميلاد" })).toBeTruthy();
  });

  it("icon-grid shows the resolved icon before the image", async () => {
    const values: DiscoveryValues = {
      name: "x",
      defaults: { icon: "gift" },
      options: [
        {
          value: "eid",
          name: "العيد",
          count: 4,
          visual: { image: { mediaId: M1, fit: "cover" } },
          imageSources: sources(),
        },
      ],
    };
    const { container } = render(
      (await renderSection(values, {
        layout: "icon-grid",
      })) as React.JSX.Element,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      container
        .querySelector("[data-facet-content]")
        ?.getAttribute("data-facet-content"),
    ).toBe("icon");
  });
});

describe("showLabel=false", () => {
  it("keeps the value name as the accessible name (visually hidden) and a title", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-grid",
      showLabel: false,
    });
    const { container } = render(el as React.JSX.Element);
    const link = screen.getByRole("link", { name: "العيد" });
    expect(link.getAttribute("title")).toBe("العيد");
    const label = within(link).getByText("العيد");
    expect(label.className).toContain("sr-only");
    // the image is decorative
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("does not show a visible count beside a hidden name, but still describes it to assistive technology", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-grid",
      showLabel: false,
      showCounts: true,
    });
    const { container } = render(el as React.JSX.Element);
    const link = screen.getByRole("link", { name: "العيد" });
    expect(within(link).queryByText("40")).toBeNull();
    const described = link.getAttribute("aria-describedby") as string;
    expect(container.querySelector(`#${described}`)?.textContent).toBe(
      "discoveryProductCount|40",
    );
  });
});

describe("fallback states (image -> icon -> text, shape and size kept)", () => {
  it("a value with no visual draws a shaped frame with the initial and a visible name", async () => {
    const el = await renderSection(visualFacet, { layout: "image-grid" });
    render(el as React.JSX.Element);
    const tile = screen.getByRole("link", { name: "بلا هوية" })
      .firstElementChild as HTMLElement;
    expect(tile.dataset.facetContent).toBe("initial");
    const frame = tile.firstElementChild as HTMLElement;
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.style.aspectRatio).toBe("1 / 1");
    expect(frame.textContent).toBe("ب");
  });

  it("an image that fails to load falls back to the icon without changing the frame", async () => {
    const values: DiscoveryValues = {
      ...visualFacet,
      defaults: { icon: "gift" },
    };
    const el = await renderSection(values, { layout: "image-grid" });
    const { container } = render(el as React.JSX.Element);
    const img = container.querySelector("img") as HTMLImageElement;
    const frame = img.parentElement as HTMLElement;
    const width = frame.style.width;
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    const tile = screen.getByRole("link", { name: "العيد" })
      .firstElementChild as HTMLElement;
    expect(tile.dataset.facetContent).toBe("icon");
    expect((tile.firstElementChild as HTMLElement).style.width).toBe(width);
  });

  it("a value whose image has no sources never requests an image", async () => {
    const values: DiscoveryValues = {
      name: "x",
      defaults: { icon: "gift" },
      options: [
        {
          value: "eid",
          name: "العيد",
          count: 4,
          visual: { image: { mediaId: M1, fit: "cover" } },
        },
      ],
    };
    const { container } = render(
      (await renderSection(values, {
        layout: "image-cards",
      })) as React.JSX.Element,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      container
        .querySelector("[data-facet-content]")
        ?.getAttribute("data-facet-content"),
    ).toBe("icon");
  });

  it("an explicit text-only value stays a frameless label", async () => {
    const values: DiscoveryValues = {
      name: "x",
      options: [
        { value: "t", name: "نص فقط", count: 1, visual: { content: "none" } },
      ],
    };
    render(
      (await renderSection(values, {
        layout: "image-grid",
      })) as React.JSX.Element,
    );
    const tile = screen.getByRole("link", { name: "نص فقط" })
      .firstElementChild as HTMLElement;
    expect(tile.dataset.facetContent).toBe("none");
  });
});

describe("brand axis", () => {
  const brands: DiscoveryValues = {
    name: "",
    options: [
      { value: BRAND, name: "نبراس", count: 7 },
      { value: "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d02", name: "Zara", count: 3 },
    ],
  };

  it("has no visuals: media layouts draw initials in the resolved shape, linked by brand_id", async () => {
    const { container } = render(
      (await renderSection(brands, {
        axis: "brand",
        dimension: undefined,
        layout: "image-grid",
      })) as React.JSX.Element,
    );
    expect(screen.getByRole("heading").textContent).toBe("shopByBrand");
    expect(container.querySelector("img")).toBeNull();
    const first = screen.getByRole("link", { name: "نبراس" });
    expect(
      new URL(
        first.getAttribute("href") as string,
        "https://x.test",
      ).searchParams.get("brand_id"),
    ).toBe(BRAND);
    expect((first.firstElementChild as HTMLElement).dataset.facetContent).toBe(
      "initial",
    );
    expect(first.textContent).toBe("ننبراس");
    expect(screen.getByRole("link", { name: "Zara" }).textContent).toBe(
      "ZZara",
    );
  });

  it("text-list is the cleanest: names only", async () => {
    render(
      (await renderSection(brands, {
        axis: "brand",
        dimension: undefined,
        layout: "text-list",
      })) as React.JSX.Element,
    );
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "نبراس",
      "Zara",
    ]);
  });
});

// ───────────────────────────── display options ─────────────────────────────

describe("display options", () => {
  it("columns per device are CSS custom properties read by static classes (never built class names)", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-grid",
      columns: { mobile: 3, tablet: 5, desktop: 7 },
    });
    render(el as React.JSX.Element);
    const list = document.querySelector(
      "[data-discovery-layout]",
    ) as HTMLElement;
    expect(list.style.getPropertyValue("--disc-cols-m")).toBe("3");
    expect(list.style.getPropertyValue("--disc-cols-t")).toBe("5");
    expect(list.style.getPropertyValue("--disc-cols-d")).toBe("7");
    expect(list.className).toContain(
      "grid-cols-[repeat(var(--disc-cols-m),minmax(0,1fr))]",
    );
    expect(list.className).toContain(
      "sm:grid-cols-[repeat(var(--disc-cols-t),minmax(0,1fr))]",
    );
    expect(list.className).toContain(
      "lg:grid-cols-[repeat(var(--disc-cols-d),minmax(0,1fr))]",
    );
    expect(list.className).not.toMatch(/grid-cols-[3-7]\b/);
  });

  it("a template supplies columns/shape/size/text position that an explicit value overrides", async () => {
    const el = await renderSection(visualFacet, {
      template: "gift-circles",
      shape: "square",
      columns: { desktop: 4 },
    });
    render(el as React.JSX.Element);
    const list = document.querySelector(
      "[data-discovery-layout]",
    ) as HTMLElement;
    expect(list.getAttribute("data-discovery-layout")).toBe("image-grid");
    expect(list.style.getPropertyValue("--disc-cols-m")).toBe("3");
    expect(list.style.getPropertyValue("--disc-cols-t")).toBe("4");
    expect(list.style.getPropertyValue("--disc-cols-d")).toBe("4");
    const frame = document.querySelector(
      "[data-facet-content] > span",
    ) as HTMLElement;
    expect(frame.style.borderRadius).toBe("0px");
  });

  it.each(
    DISCOVERY_TEMPLATE_IDS,
  )("template %s renders its layout with every value as a link", async (template) => {
    const el = await renderSection(visualFacet, { template });
    render(el as React.JSX.Element);
    expect(document.querySelector("[data-discovery-layout]")).not.toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("gap, card style and alignment map to static classes", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-cards",
      gap: "loose",
      cardStyle: "elevated",
      align: "start",
    });
    render(el as React.JSX.Element);
    const list = document.querySelector(
      "[data-discovery-layout]",
    ) as HTMLElement;
    expect(list.className).toContain("gap-5");
    const link = screen.getAllByRole("link")[0];
    expect(link.className).toContain("shadow-md");
    expect(link.className).toContain("items-start");
    expect(link.className).toContain("text-start");
  });

  it("cardStyle outlined and filled use store tokens", async () => {
    const outlined = render(
      (await renderSection(visualFacet, {
        layout: "image-grid",
        cardStyle: "outlined",
      })) as React.JSX.Element,
    );
    expect(screen.getAllByRole("link")[0].className).toContain(
      "border-store-border",
    );
    outlined.unmount();
    render(
      (await renderSection(visualFacet, {
        layout: "image-grid",
        cardStyle: "filled",
      })) as React.JSX.Element,
    );
    expect(screen.getAllByRole("link")[0].className).toContain(
      "bg-store-surface-muted",
    );
  });

  it("sorts by count (ties in API order) and caps at maxItems", async () => {
    const values: DiscoveryValues = {
      name: "x",
      options: [1, 9, 3, 9, 5, 1].map((count, i) => ({
        value: `v${i}`,
        name: `n${i}`,
        count,
      })),
    };
    render(
      (await renderSection(values, {
        layout: "image-grid",
        valueSort: "count",
        maxItems: 4,
      })) as React.JSX.Element,
    );
    expect(
      screen.getAllByRole("link").map((a) => a.textContent?.slice(-2)),
    ).toEqual(["n1", "n3", "n4", "n2"]);
  });

  it("merchant order keeps the API order", async () => {
    const values: DiscoveryValues = {
      name: "x",
      options: [1, 9, 3].map((count, i) => ({
        value: `v${i}`,
        name: `n${i}`,
        count,
      })),
    };
    render(
      (await renderSection(values, {
        layout: "text-list",
        valueSort: "merchant",
      })) as React.JSX.Element,
    );
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "n0",
      "n1",
      "n2",
    ]);
  });

  it("contentSequence label-first reverses the visual order, not the DOM order", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-grid",
      contentSequence: "label-first",
    });
    render(el as React.JSX.Element);
    const tile = screen.getAllByRole("link")[0]
      .firstElementChild as HTMLElement;
    expect(tile.className).toContain("flex-col-reverse");
    expect(
      (tile.firstElementChild as HTMLElement).getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("showCounts: a visible, hidden-from-AT number plus a spoken description outside the link name", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-grid",
      showCounts: true,
    });
    render(el as React.JSX.Element);
    const link = screen.getByRole("link", { name: "العيد" });
    const visible = within(link).getByText("40");
    expect(visible.getAttribute("aria-hidden")).toBe("true");
    expect(
      document.getElementById(link.getAttribute("aria-describedby") as string)
        ?.textContent,
    ).toBe("discoveryProductCount|40");
  });

  it("showCounts is off by default", async () => {
    render(
      (await renderSection(visualFacet, {
        layout: "image-grid",
      })) as React.JSX.Element,
    );
    expect(
      screen.getAllByRole("link")[0].getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("long Arabic names clamp to two lines with a title, without breaking the cell", async () => {
    const el = await renderSection(visualFacet, { layout: "image-grid" });
    render(el as React.JSX.Element);
    const link = screen.getByRole("link", { name: /^هدية تقدير/ });
    const label = within(link).getByText(/^هدية تقدير/);
    expect(label.className).toContain("line-clamp-2");
    expect(label.getAttribute("title")).toContain("هدية تقدير");
    expect(link.className).toContain("min-w-0");
    expect(link.closest("li")?.className).toContain("min-w-0");
  });
});

describe("textPosition", () => {
  it("overlay puts the caption on the frame over the scrim token", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-cards",
      textPosition: "overlay",
    });
    render(el as React.JSX.Element);
    const tile = screen.getByRole("link", { name: "العيد" })
      .firstElementChild as HTMLElement;
    expect(tile.className).toContain(
      "[&>span:last-child:not(.sr-only)]:bg-store-scrim",
    );
    expect(tile.className).toContain(
      "[&>span:last-child:not(.sr-only)]:text-store-scrim-foreground",
    );
    expect(tile.className).toContain(
      "[&>span:last-child:not(.sr-only)]:bottom-1.5",
    );
    expect(tile.className).not.toMatch(/(^|\s)w-full(\s|$)/);
  });

  it("overlay with label-first anchors the caption at the top", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-cards",
      textPosition: "overlay",
      contentSequence: "label-first",
    });
    render(el as React.JSX.Element);
    const tile = screen.getByRole("link", { name: "العيد" })
      .firstElementChild as HTMLElement;
    expect(tile.className).toContain(
      "[&>span:last-child:not(.sr-only)]:top-1.5",
    );
  });

  it("a frameless text-only item is never overlaid (there is no frame to sit on)", async () => {
    const values: DiscoveryValues = {
      name: "x",
      options: [
        { value: "t", name: "نص فقط", count: 1, visual: { content: "none" } },
      ],
    };
    render(
      (await renderSection(values, {
        layout: "image-cards",
        textPosition: "overlay",
      })) as React.JSX.Element,
    );
    const tile = screen.getByRole("link", { name: "نص فقط" })
      .firstElementChild as HTMLElement;
    expect(tile.className).not.toContain("bg-store-scrim");
  });

  it("beside lays the frame and caption in a row", async () => {
    const el = await renderSection(visualFacet, {
      layout: "image-grid",
      textPosition: "beside",
    });
    render(el as React.JSX.Element);
    const link = screen.getAllByRole("link")[0];
    const tile = link.firstElementChild as HTMLElement;
    expect(link.className).toContain("flex-row");
    expect(tile.className).toContain("flex-row");
    expect(tile.className).toContain("text-start");
  });

  it("the scrim pair keeps the caption at >= 4.5:1 over the worst-case (white) photo", () => {
    const css = readFileSync(
      resolve(__dirname, "../../../app/globals.css"),
      "utf8",
    );
    const scrim = css.match(
      /--store-scrim:\s*rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/,
    );
    const fg = css.match(/--store-scrim-foreground:\s*(#[0-9a-fA-F]{6})/);
    expect(scrim).not.toBeNull();
    expect(fg).not.toBeNull();
    const [r, g, b, alpha] = (scrim as RegExpMatchArray).slice(1).map(Number);
    // composite over white, the lightest possible photo pixel
    const over = (c: number) => Math.round(c * alpha + 255 * (1 - alpha));
    const hex = `#${[over(r), over(g), over(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    expect(
      contrastRatio((fg as RegExpMatchArray)[1], hex),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("carousel", () => {
  it("is a native scroll-snap row: snap, contained overscroll, motion-safe smooth scrolling", async () => {
    const el = await renderSection(visualFacet, { layout: "carousel" });
    render(el as React.JSX.Element);
    const list = document.querySelector(
      "[data-discovery-layout=carousel]",
    ) as HTMLElement;
    for (const cls of [
      "overflow-x-auto",
      "snap-x",
      "snap-mandatory",
      "overscroll-x-contain",
      "motion-safe:scroll-smooth",
      "grid-flow-col",
    ]) {
      expect(list.className).toContain(cls);
    }
    // smooth scrolling is only ever applied behind motion-safe
    expect(list.className).not.toMatch(/(^|\s)scroll-smooth/);
    expect(list.className).toContain("relative");
    for (const li of list.querySelectorAll("li"))
      expect(li.className).toContain("snap-start");
    // links are the focusable content: no extra tab stops, no negative tabindex
    expect(list.getAttribute("tabindex")).toBeNull();
    expect(list.querySelector("[tabindex]")).toBeNull();
  });

  describe("focus reveal (VD-5 / D-S-2)", () => {
    // jsdom has no layout and no scrollIntoView: the geometry is stubbed per element, the scroll call is observed.
    // The Chromium behaviour behind it (a partly visible focused tile is never scrolled into view) was proven in a real
    // browser; here the unit contract is "a partly clipped focused tile is aligned to the rail's inline-start edge".
    const rect = (left: number, right: number) =>
      ({
        left,
        right,
        top: 0,
        bottom: 100,
        width: right - left,
        height: 100,
      }) as DOMRect;
    const scrollIntoView = vi.fn();

    async function renderRail(
      rails: { left: number; right: number },
      tiles: Array<[number, number]>,
    ) {
      render(
        (await renderSection(visualFacet, {
          layout: "carousel",
        })) as React.JSX.Element,
      );
      const list = document.querySelector(
        "[data-discovery-layout=carousel]",
      ) as HTMLElement;
      vi.spyOn(list, "getBoundingClientRect").mockReturnValue(
        rect(rails.left, rails.right),
      );
      const items = [...list.querySelectorAll("li")];
      items.forEach((li, index) => {
        const [left, right] = tiles[index] ?? [0, 0];
        vi.spyOn(li, "getBoundingClientRect").mockReturnValue(
          rect(left, right),
        );
        li.scrollIntoView = scrollIntoView;
      });
      return { list, items };
    }

    beforeEach(() => scrollIntoView.mockClear());

    const focusVisible = (link: HTMLElement, visible: boolean | "throws") =>
      vi.spyOn(link, "matches").mockImplementation((selector: string) => {
        if (selector !== ":focus-visible") return false;
        if (visible === "throws") throw new SyntaxError("unsupported");
        return visible;
      });

    it("reveals a focused tile that is only partly inside the rail (aligned to the snap-start edge)", async () => {
      const { items } = await renderRail({ left: 8, right: 382 }, [
        [270, 374],
        [-78, 26],
      ]);
      const link = items[1].querySelector("a") as HTMLElement;
      focusVisible(link, true);
      fireEvent.focus(link);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
        inline: "start",
      });
      expect(scrollIntoView.mock.contexts[0]).toBe(items[1]);
    });

    it("also reveals a tile clipped on the opposite edge", async () => {
      const { items } = await renderRail({ left: 8, right: 382 }, [[300, 404]]);
      const link = items[0].querySelector("a") as HTMLElement;
      focusVisible(link, true);
      fireEvent.focus(link);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("does NOT scroll on pointer-initiated focus (not :focus-visible): a click must not move under the pointer", async () => {
      const { items } = await renderRail({ left: 8, right: 382 }, [
        [270, 374],
        [-78, 26],
      ]);
      const link = items[1].querySelector("a") as HTMLElement;
      focusVisible(link, false);
      fireEvent.focus(link);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("treats an engine that cannot evaluate :focus-visible as keyboard (the fix is never lost)", async () => {
      const { items } = await renderRail({ left: 8, right: 382 }, [
        [270, 374],
        [-78, 26],
      ]);
      const link = items[1].querySelector("a") as HTMLElement;
      focusVisible(link, "throws");
      fireEvent.focus(link);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("ignores sub-pixel overhang (0.5px) of a fully visible tile", async () => {
      const { items } = await renderRail({ left: 8, right: 382 }, [
        [7.6, 111.6],
      ]);
      const link = items[0].querySelector("a") as HTMLElement;
      focusVisible(link, true);
      fireEvent.focus(link);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("leaves a fully visible tile alone: ordinary Tab never makes the rail jump", async () => {
      const { items } = await renderRail({ left: 8, right: 382 }, [
        [270, 374],
        [154, 258],
      ]);
      for (const li of items.slice(0, 2)) {
        const link = li.querySelector("a") as HTMLElement;
        focusVisible(link, true);
        fireEvent.focus(link);
      }
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("adds no element, role, tab stop or attribute: the scroller is still the server's plain <ul>", async () => {
      const { list } = await renderRail({ left: 0, right: 100 }, []);
      expect(list.tagName).toBe("UL");
      expect(list.getAttribute("tabindex")).toBeNull();
      expect(list.getAttribute("role")).toBeNull();
      expect(list.querySelector("[tabindex]")).toBeNull();
    });
  });

  it("rows: 1 by default, 2 from the swipe-rail template or an explicit value; clamped; one row from md", async () => {
    render(
      (await renderSection(visualFacet, {
        layout: "carousel",
      })) as React.JSX.Element,
    );
    let list = document.querySelector(
      "[data-discovery-layout=carousel]",
    ) as HTMLElement;
    expect(list.style.getPropertyValue("--disc-rows")).toBe("1");
    expect(list.className).toContain(
      "grid-rows-[repeat(var(--disc-rows),auto)]",
    );
    expect(list.className).toContain("md:grid-rows-1");
    document.body.innerHTML = "";
    render(
      (await renderSection(visualFacet, {
        template: "swipe-rail",
      })) as React.JSX.Element,
    );
    list = document.querySelector(
      "[data-discovery-layout=carousel]",
    ) as HTMLElement;
    expect(list.style.getPropertyValue("--disc-rows")).toBe("2");
    document.body.innerHTML = "";
    render(
      (await renderSection(visualFacet, {
        template: "swipe-rail",
        rows: 1,
      })) as React.JSX.Element,
    );
    list = document.querySelector(
      "[data-discovery-layout=carousel]",
    ) as HTMLElement;
    expect(list.style.getPropertyValue("--disc-rows")).toBe("1");
  });

  it("rows never apply to a non-carousel layout (no row variable at all)", async () => {
    render(
      (await renderSection(visualFacet, {
        layout: "image-grid",
        rows: 2,
      })) as React.JSX.Element,
    );
    const list = document.querySelector(
      "[data-discovery-layout]",
    ) as HTMLElement;
    expect(list.style.getPropertyValue("--disc-rows")).toBe("");
  });

  it("each column is as wide as the largest frame", async () => {
    render(
      (await renderSection(visualFacet, {
        layout: "carousel",
        size: "lg",
      })) as React.JSX.Element,
    );
    const list = document.querySelector(
      "[data-discovery-layout=carousel]",
    ) as HTMLElement;
    expect(list.style.getPropertyValue("--disc-item")).toBe("136px");
  });
});

describe("RTL / LTR and tokens", () => {
  it.each([
    "image-grid",
    "image-cards",
    "carousel",
    "icon-grid",
    "text-list",
  ] as const)("%s uses logical properties and store tokens only (no physical left/right, no raw colours)", async (layout) => {
    const el = await renderSection(visualFacet, {
      layout,
      showCounts: true,
      textPosition: layout === "image-cards" ? "overlay" : "below",
    });
    const html = renderToStaticMarkup(el as React.JSX.Element);
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) =>
      m[1].split(/\s+/),
    );
    const physical = classes.filter((c) =>
      /(^|:)-?(ml|mr|pl|pr|left|right|text-left|text-right|float-left|float-right|rounded-l|rounded-r|border-l|border-r)(-|$)/.test(
        c,
      ),
    );
    expect(physical).toEqual([]);
    expect(html).not.toMatch(/class="[^"]*#[0-9a-fA-F]{3,8}/);
  });

  it("the same markup serves both directions: direction comes from the document, not the component", async () => {
    const ar = renderToStaticMarkup(
      (await renderSection(visualFacet, {
        layout: "carousel",
      })) as React.JSX.Element,
    );
    const en = renderToStaticMarkup(
      (await renderSection(
        visualFacet,
        { layout: "carousel" },
        { locale: "en" },
      )) as React.JSX.Element,
    );
    expect(ar).toBe(en);
  });
});

// ───────────────────────────── review fixes ─────────────────────────────

describe("hidden name follows the tile's own rule (showLabel || !drawsMedia)", () => {
  const withNoVisual: DiscoveryValues = {
    name: "x",
    options: [
      { value: "plain", name: "بلا هوية", count: 3 },
      { value: "t", name: "نص فقط", count: 5, visual: { content: "none" } },
      {
        value: "birthday",
        name: "عيد ميلاد",
        count: 9,
        visual: { icon: "gift" },
      },
    ],
  };

  it.each([
    "image-grid",
    "icon-grid",
    "carousel",
  ] as const)("%s: showLabel=false + showCounts, a value with no visual shows its name AND its count, with no redundant title", async (layout) => {
    render(
      (await renderSection(withNoVisual, {
        layout,
        showLabel: false,
        showCounts: true,
      })) as React.JSX.Element,
    );
    const plain = screen.getByRole("link", { name: "بلا هوية" });
    // the tile shows the name (initial-only frame) and the count is visible beside it
    expect(within(plain).getByText("بلا هوية").className).not.toContain(
      "sr-only",
    );
    expect(within(plain).getByText("3").getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(plain.getAttribute("title")).toBeNull();
    // text-by-choice also shows its name and count
    const text = screen.getByRole("link", { name: "نص فقط" });
    expect(within(text).getByText("5")).toBeTruthy();
    expect(text.getAttribute("title")).toBeNull();
    // an icon IS drawn, so the name is hidden: no visible count, a title, the count still described
    const icon = screen.getByRole("link", { name: "عيد ميلاد" });
    expect(within(icon).getByText("عيد ميلاد").className).toContain("sr-only");
    expect(within(icon).queryByText("9")).toBeNull();
    expect(icon.getAttribute("title")).toBe("عيد ميلاد");
    expect(
      document.getElementById(icon.getAttribute("aria-describedby") as string)
        ?.textContent,
    ).toBe("discoveryProductCount|9");
  });

  it("text-list ignores showLabel: the name and the count are always visible", async () => {
    render(
      (await renderSection(withNoVisual, {
        layout: "text-list",
        showLabel: false,
        showCounts: true,
      })) as React.JSX.Element,
    );
    const plain = screen.getByRole("link", { name: "بلا هوية" });
    expect(within(plain).getByText("3")).toBeTruthy();
    expect(plain.getAttribute("title")).toBeNull();
  });
});

describe("count description is read once", () => {
  it("the description span is aria-hidden (describedby still resolves it) and sits outside the link", async () => {
    render(
      (await renderSection(visualFacet, {
        layout: "image-grid",
        showCounts: true,
      })) as React.JSX.Element,
    );
    for (const link of screen.getAllByRole("link")) {
      const description = document.getElementById(
        link.getAttribute("aria-describedby") as string,
      );
      expect(description).not.toBeNull();
      expect(description?.getAttribute("aria-hidden")).toBe("true");
      expect(link.contains(description)).toBe(false);
    }
  });
});

describe("count ids are unique across sections on one page", () => {
  it("two sections with different headingIds never share an aria-describedby id", async () => {
    const first = await renderSection(
      visualFacet,
      { layout: "image-grid", showCounts: true },
      { headingId: "discovery-a" },
    );
    const second = await renderSection(
      visualFacet,
      { layout: "text-list", showCounts: true },
      { headingId: "discovery-b" },
    );
    render(
      <>
        {first}
        {second}
      </>,
    );
    const ids = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("aria-describedby") as string);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    expect(
      ids.filter((id) => id.startsWith("discovery-a-count-")),
    ).toHaveLength(4);
    expect(
      ids.filter((id) => id.startsWith("discovery-b-count-")),
    ).toHaveLength(4);
    for (const id of ids)
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
  });
});

describe("image sources are re-validated where they become <img> (defence in depth)", () => {
  const OTHER_MEDIA = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d99";
  const P = `/api/storefront/media/facet-visuals/${V1}/${M1}`;
  const good = (file: string, width: number, format: "webp" | "jpg") => ({
    width,
    format,
    src: `${P}/${file}`,
  });
  const hostile: ListingFacetImageSource[] = [
    { width: 1e9, format: "webp", src: "https://evil.test/x.webp" },
    { width: 160, format: "webp", src: "https://evil.test/x.webp" },
    {
      width: 160,
      format: "webp",
      src: "/not/the/proxy/aaaa/bbbb/thumb-160.webp",
    },
    {
      width: 160,
      format: "webp",
      src: `/store/v1/media/facet-visuals/${V1}/${M1}/thumb-160.webp`,
    },
    {
      width: 160,
      format: "webp",
      src: `/api/storefront/media/facet-visuals/${V1}/${OTHER_MEDIA}/thumb-160.webp`,
    },
    { width: 160, format: "webp", src: `${P}/original.png` },
    { width: 160, format: "webp", src: `${P}/thumb-160.jpg` },
    { width: 160, format: "webp", src: `${P}/..%2Fx.webp` },
    { width: 0, format: "webp", src: `${P}/thumb-160.webp` },
    { width: 1.5, format: "webp", src: `${P}/thumb-160.webp` },
    { width: 5000, format: "webp", src: `${P}/thumb-320.webp` },
    { width: 320, format: "webp", src: `${P}/thumb-320.webp?x=1` },
    { width: 480, format: "gif" as never, src: `${P}/480w.webp` },
  ];
  const values = (
    imageSources: ListingFacetImageSource[],
  ): DiscoveryValues => ({
    name: "x",
    defaults: { icon: "gift" },
    options: [
      {
        value: "eid",
        name: "العيد",
        count: 4,
        visual: { image: { mediaId: M1, fit: "cover" } },
        imageSources,
      },
    ],
  });

  it("drops every hostile source: no such URL reaches the markup, and the tile falls back to the icon", async () => {
    for (const layout of [
      "image-grid",
      "image-cards",
      "carousel",
      "icon-grid",
    ] as const) {
      const el = await renderSection(values(hostile), { layout });
      const html = renderToStaticMarkup(el as React.JSX.Element);
      expect(html).not.toContain("<img");
      for (const text of [
        "evil.test",
        "/store/v1/",
        "/not/the/proxy",
        OTHER_MEDIA,
        "original.png",
        "..%2F",
        "1000000000",
        "5000w",
        "?x=1",
        ".jpg",
      ]) {
        expect(html).not.toContain(text);
      }
      expect(html).toContain('data-facet-content="icon"');
    }
  });

  it("keeps only the valid sources of a mixed list", async () => {
    const mixed = [
      ...hostile,
      good("thumb-160.webp", 160, "webp"),
      good("thumb-320.webp", 320, "webp"),
    ];
    const { container } = render(
      (await renderSection(values(mixed), {
        layout: "image-grid",
      })) as React.JSX.Element,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("srcset")).toBe(
      `${P}/thumb-160.webp 160w, ${P}/thumb-320.webp 320w`,
    );
    expect(img.getAttribute("src")).toBe(`${P}/thumb-160.webp`);
  });
});

describe("page locale (AWJ-VD-H1 D-S-1)", () => {
  it("reads the values for the locale the section was rendered for", async () => {
    await renderSection(plainFacet, {}, { basePath: "/sa/en", locale: "en" });
    expect(mocks.fetchDiscoveryValues).toHaveBeenCalledWith(
      { axis: "facet", dimension: "occasion" },
      "en",
    );
  });
});

describe("no section when there is nothing to show", () => {
  it("returns null for a failed or empty read in every layout", async () => {
    for (const layout of ["image-grid", "carousel", "text-list"] as const) {
      expect(await renderSection(null, { layout })).toBeNull();
    }
    mocks.fetchDiscoveryValues.mockRejectedValueOnce(new Error("down"));
    expect(
      await DiscoverySection({
        ...base,
        content: content({ layout: "image-grid" }),
      }),
    ).toBeNull();
  });
});
