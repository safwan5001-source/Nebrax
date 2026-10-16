/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { CategoryDisplay } from "@/lib/presentation/section-design";
import { publishedNodes } from "../published-nodes";
import {
  CATEGORY_FIXTURE,
  LEGACY_MARKET_HTML,
  LEGACY_MODERN_HTML,
} from "./categories-legacy-golden";

/**
 * AWJ-STORE-CAT-DESIGN-01 — the published categories section: the classic tile stays byte-identical without a display,
 * and with one every layout keeps the same categories, order, cap and links.
 */

afterEach(() => {
  cleanup();
  vi.resetModules();
});

function category(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `c${i}`,
    name: `قسم ${i}`,
    color: null,
    image: null,
    children: undefined,
    permalink: `c${i}`,
    ...extra,
  };
}

async function loadSection(
  data: unknown[],
  props: {
    themePreset?: "awj-market";
    display?: CategoryDisplay;
    locale?: string;
  } = {},
) {
  vi.resetModules();
  vi.doMock("next-intl/server", () => ({
    getTranslations: vi.fn(
      async () => (key: string, v?: Record<string, unknown>) =>
        v ? `${key}:${v.count}` : key,
    ),
  }));
  vi.doMock("@/lib/data/categories", () => ({
    getCategories: vi.fn().mockResolvedValue({ data }),
  }));
  const { CategoriesSection } = await import(
    "@/components/home/CategoriesSection"
  );
  return CategoriesSection({
    basePath: "/sa/ar",
    locale: props.locale ?? "ar",
    country: "sa",
    themePreset: props.themePreset,
    display: props.display,
  });
}

const html = async (
  data: unknown[],
  props?: Parameters<typeof loadSection>[1],
) => {
  const element = await loadSection(data, props);
  const { container } = render(element as React.JSX.Element);
  return container;
};

describe("existing live stores do not regress (no design.display)", () => {
  it("renders the classic section byte-for-byte as the pre-change component did (default theme)", async () => {
    const container = await html(CATEGORY_FIXTURE);
    expect(container.innerHTML).toBe(LEGACY_MODERN_HTML);
  });

  it("renders the classic section byte-for-byte as the pre-change component did (AWJ Market)", async () => {
    const container = await html(CATEGORY_FIXTURE, {
      themePreset: "awj-market",
    });
    expect(container.innerHTML).toBe(LEGACY_MARKET_HTML);
  });

  it("an undefined display is the same as no display", async () => {
    const container = await html(CATEGORY_FIXTURE, { display: undefined });
    expect(container.innerHTML).toBe(LEGACY_MODERN_HTML);
    expect(container.querySelector(".awj-cd")).toBeNull();
  });
});

const LAYOUTS = [
  "grid",
  "horizontal_scroll",
  "circles",
  "image_tiles",
  "compact_list",
] as const;

describe("each layout keeps the categories, their order, the cap and the links", () => {
  const classicLinks = async (data: unknown[]) =>
    Array.from((await html(data)).querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );

  for (const layout of LAYOUTS) {
    it(`${layout}: same hrefs in the same order as the classic section`, async () => {
      const data = Array.from({ length: 5 }, (_, i) => category(i + 1));
      const expected = await classicLinks(data);
      cleanup();
      const container = await html(data, { display: { layout } });
      const list = container.querySelector("ul.awj-cd");
      expect(list).not.toBeNull();
      expect(list?.getAttribute("data-cd-layout")).toBe(layout);
      expect(
        Array.from(container.querySelectorAll("a")).map((a) =>
          a.getAttribute("href"),
        ),
      ).toEqual(expected);
      expect(container.querySelectorAll("li")).toHaveLength(5);
    });

    it(`${layout}: still caps a long catalogue at 12 and offers the full list`, async () => {
      const data = Array.from({ length: 20 }, (_, i) => category(i + 1));
      const container = await html(data, { display: { layout } });
      const links = Array.from(container.querySelectorAll("a")).map((a) =>
        a.getAttribute("href"),
      );
      expect(links).toHaveLength(13); // 12 tiles + the catch-all
      expect(links).toContain("/sa/ar/products");
      expect(container.querySelectorAll("li")).toHaveLength(12);
    });

    it(`${layout}: renders nothing for zero categories, one tile for one`, async () => {
      expect(await loadSection([], { display: { layout } })).toBeNull();
      const one = await html([category(1)], { display: { layout } });
      expect(one.querySelectorAll("li")).toHaveLength(1);
    });
  }

  it("AWJ Market keeps its higher ceiling under a display too", async () => {
    const data = Array.from({ length: 20 }, (_, i) => category(i + 1));
    const container = await html(data, {
      themePreset: "awj-market",
      display: { layout: "grid" },
    });
    expect(container.querySelectorAll("li")).toHaveLength(18);
  });

  it("keeps the section landmark, heading id and view-all action", async () => {
    const container = await html(
      Array.from({ length: 20 }, (_, i) => category(i + 1)),
      { display: { layout: "grid" } },
    );
    expect(
      container.querySelector("section")?.getAttribute("aria-labelledby"),
    ).toBe("home-categories");
    expect(container.querySelector("h2#home-categories")).not.toBeNull();
  });
});

describe("names and accessible names", () => {
  const data = [
    category(1, { name: "إلكترونيات" }),
    category(2, { name: "المنزل" }),
  ];

  it("a visible name is the link's text and the link needs no aria-label", async () => {
    const container = await html(data, { display: { layout: "grid" } });
    const [first] = Array.from(container.querySelectorAll("a"));
    expect(first.textContent).toBe("إلكترونيات");
    expect(first.hasAttribute("aria-label")).toBe(false);
    expect(first.querySelector(".awj-cd__name")).not.toBeNull();
  });

  it("a hidden name keeps the category's accessible name on the link", async () => {
    const container = await html(data, {
      display: { layout: "grid", name: { show: false } },
    });
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual([
      "إلكترونيات",
      "المنزل",
    ]);
    expect(links.map((a) => a.getAttribute("title"))).toEqual([
      "إلكترونيات",
      "المنزل",
    ]);
    expect(container.querySelector(".awj-cd__name")).toBeNull();
    // Nothing visible repeats the name, but the tile is still drawn (a frame is there to click).
    expect(container.querySelectorAll(".awj-cd__media")).toHaveLength(2);
  });

  it("hiding the picture keeps the name; hiding both keeps the name too", async () => {
    const noImage = await html(data, {
      display: { layout: "grid", image: { show: false } },
    });
    expect(noImage.querySelector(".awj-cd__media")).toBeNull();
    expect(noImage.querySelectorAll(".awj-cd__name")).toHaveLength(2);
    cleanup();
    const neither = await html(data, {
      display: {
        layout: "grid",
        image: { show: false },
        name: { show: false },
      },
    });
    expect(neither.querySelectorAll(".awj-cd__name")).toHaveLength(2);
  });

  it("a long Arabic name is clamped and breakable, never widening the tile", async () => {
    const long = "المنزل والحديقة والأدوات المنزلية الطويلة جدا جدا ".repeat(4);
    const container = await html([category(1, { name: long })], {
      display: { layout: "grid", name: { lines: 2 } },
    });
    const name = container.querySelector(".awj-cd__name");
    const text = container.querySelector(".awj-cd__name-text");
    expect(text?.getAttribute("data-cd-clamp")).toBe("2");
    // The clamp is on the inner text, not the padded name element (hidden lines would show through padding).
    expect(name?.hasAttribute("data-cd-clamp")).toBe(false);
    expect(name?.textContent).toBe(long);
    expect(container.querySelector(".awj-cd")?.getAttribute("style")).toContain(
      "--cd-lines: 2",
    );
  });

  it("natural height carries no clamp attribute", async () => {
    const container = await html([category(1)], {
      display: { layout: "grid", name: { lines: "natural" } },
    });
    expect(
      container
        .querySelector(".awj-cd__name-text")
        ?.hasAttribute("data-cd-clamp"),
    ).toBe(false);
  });
});

describe("pictures and the fallback frame", () => {
  const withImage = category(1, {
    image: { url: "/store/v1/media/categories/c1", alt: "هواتف" },
  });
  const withColor = category(2, { color: "#12372a", name: "ملابس" });
  const bare = category(3, { name: "أخرى" });

  it("draws the merchant's picture decoratively inside the frame, with object-fit from the stylesheet", async () => {
    const container = await html([withImage], {
      display: { layout: "grid", image: { fit: "contain", position: "top" } },
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("/store/v1/media/categories/c1");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.classList.contains("awj-cd__img")).toBe(true);
    expect(img?.closest(".awj-cd__media")).not.toBeNull();
    const style = container.querySelector(".awj-cd")?.getAttribute("style");
    expect(style).toContain("--cd-fit: contain");
    expect(style).toContain("--cd-op: center top");
  });

  it("a category without a picture gets the fallback frame, never a broken image", async () => {
    const container = await html([withColor, bare], {
      display: { layout: "grid" },
    });
    expect(container.querySelector("img")).toBeNull();
    const frames = container.querySelectorAll(".awj-cd__fallback");
    expect(frames).toHaveLength(2);
    for (const frame of Array.from(frames)) {
      expect(frame.getAttribute("aria-hidden")).toBe("true");
    }
    // The merchant's colour paints the frame (validated hex); a category without one stays neutral.
    expect((frames[0] as HTMLElement).style.backgroundColor).toBe(
      "rgb(18, 55, 42)",
    );
    expect((frames[1] as HTMLElement).style.backgroundColor).toBe("");
  });

  it("an invalid merchant colour never reaches a style attribute", async () => {
    const container = await html(
      [category(1, { color: "url(javascript:alert(1))" })],
      { display: { layout: "grid" } },
    );
    expect(container.innerHTML).not.toContain("javascript");
    expect(
      (container.querySelector(".awj-cd__fallback") as HTMLElement).style
        .backgroundColor,
    ).toBe("");
  });

  it("circles and the compact list put the initial in the fallback frame", async () => {
    for (const layout of ["circles", "compact_list"] as const) {
      const container = await html([bare], { display: { layout } });
      expect(container.querySelector(".awj-cd__fallback")?.textContent).toBe(
        "أ",
      );
      cleanup();
    }
    const grid = await html([bare], { display: { layout: "grid" } });
    expect(grid.querySelector(".awj-cd__fallback")?.textContent).toBe("");
  });

  it("the picture is sized by the layout and never marked eager", async () => {
    const container = await html([withImage], { display: { layout: "grid" } });
    const img = container.querySelector("img");
    expect(img?.getAttribute("sizes")).toBe(
      "(min-width: 1024px) 17vw, (min-width: 640px) 33vw, 50vw",
    );
    // `next/image` is lazy by default (the test setup stubs it to a bare <img>); nothing here marks it eager or priority.
    expect(img?.getAttribute("fetchpriority")).toBeNull();
  });
});

describe("overlay and placement structure", () => {
  const data = [
    category(1, { image: { url: "/store/v1/media/categories/c1", alt: "" } }),
  ];

  it("image_tiles overlays the name inside the picture frame on the scrim", async () => {
    const container = await html(data, { display: { layout: "image_tiles" } });
    const media = container.querySelector(".awj-cd__media");
    const name = media?.querySelector(".awj-cd__name");
    expect(name).not.toBeNull();
    expect(name?.hasAttribute("data-cd-over")).toBe(true);
    expect(name?.getAttribute("data-cd-nbg")).toBe("scrim");
  });

  it("a name asked to sit over the picture with no backing still gets the scrim", async () => {
    const container = await html(data, {
      display: {
        layout: "grid",
        name: { placement: "overlay", background: "none" },
      },
    });
    expect(
      container.querySelector(".awj-cd__name")?.getAttribute("data-cd-nbg"),
    ).toBe("scrim");
  });

  it("above puts the name before the picture; below after; beside after, as a row", async () => {
    const order = async (placement: "above" | "below" | "beside") => {
      const container = await html(data, {
        display: { layout: "grid", name: { placement } },
      });
      const card = container.querySelector("a") as HTMLElement;
      const kinds = Array.from(card.children).map((el) =>
        el.classList.contains("awj-cd__media") ? "media" : "name",
      );
      const result = {
        kinds,
        placement: card.getAttribute("data-cd-placement"),
      };
      cleanup();
      return result;
    };
    expect(await order("above")).toEqual({
      kinds: ["name", "media"],
      placement: "above",
    });
    expect(await order("below")).toEqual({
      kinds: ["media", "name"],
      placement: "below",
    });
    expect(await order("beside")).toEqual({
      kinds: ["media", "name"],
      placement: "beside",
    });
  });

  it("a placement the layout cannot draw falls back to the layout's own", async () => {
    const container = await html(data, {
      display: { layout: "circles", name: { placement: "overlay" } },
    });
    expect(
      container.querySelector("a")?.getAttribute("data-cd-placement"),
    ).toBe("below");
  });

  it("the picture's shape and the card hover reach the markup as data attributes", async () => {
    const container = await html(data, {
      display: {
        layout: "grid",
        image: { shape: "circle" },
        card: { hover: "subtle" },
      },
    });
    expect(
      container.querySelector(".awj-cd__media")?.getAttribute("data-cd-shape"),
    ).toBe("circle");
    expect(
      container.querySelector(".awj-cd")?.getAttribute("data-cd-hover"),
    ).toBe("subtle");
  });
});

describe("RTL and LTR", () => {
  const data = [category(1, { image: { url: "/m/1", alt: "" } })];

  it("start/end picture positions follow the document direction", async () => {
    const display: CategoryDisplay = {
      layout: "grid",
      image: { position: "start" },
    };
    const rtl = await html(data, { display, locale: "ar" });
    expect(rtl.querySelector(".awj-cd")?.getAttribute("style")).toContain(
      "--cd-op: right center",
    );
    cleanup();
    const ltr = await html(data, { display, locale: "en" });
    expect(ltr.querySelector(".awj-cd")?.getAttribute("style")).toContain(
      "--cd-op: left center",
    );
  });

  it("no physical left/right is written into the markup", async () => {
    for (const layout of LAYOUTS) {
      const container = await html(data, { display: { layout } });
      expect(container.innerHTML, layout).not.toMatch(
        /\b(?:margin|padding|border)-(?:left|right)\b|\btext-align:\s*(?:left|right)/,
      );
      cleanup();
    }
  });
});

describe("published-nodes: the section's own display reaches the page-built node", () => {
  const base = {
    basePath: "/sa/ar",
    locale: "ar",
    apps: { iosUrl: "", androidUrl: "", appName: "" },
    benefitsTitle: "b",
    featuredTitle: "f",
    offersTitle: "o",
    appTitle: "a",
    appStoreLabel: "as",
    playStoreLabel: "ps",
    design: { primaryColor: "#12372a", accentColor: null, dir: "rtl" as const },
  };

  const Probe = ({ display }: { display?: CategoryDisplay }) => (
    <div data-probe={display ? display.layout : "classic"} />
  );

  async function render1(section: PresentationHomeSection) {
    const nodes = await publishedNodes([section], {
      ...base,
      implemented: {
        hero: null,
        categories: <Probe />,
        newArrivals: null,
        wholesale: null,
      },
    });
    const { container } = render(<>{nodes}</>);
    return container;
  }

  it("passes design.display to the categories node", async () => {
    const container = await render1({
      id: "categories",
      type: "categories",
      visible: true,
      design: { display: { layout: "circles" } },
    });
    expect(
      container.querySelector("[data-probe]")?.getAttribute("data-probe"),
    ).toBe("circles");
  });

  it("passes nothing when the section has no display (and keeps the legacy wrapper when undesigned)", async () => {
    const plain = await render1({
      id: "categories",
      type: "categories",
      visible: true,
    });
    expect(
      plain.querySelector("[data-probe]")?.getAttribute("data-probe"),
    ).toBe("classic");
    cleanup();
    const spaced = await render1({
      id: "categories",
      type: "categories",
      visible: true,
      design: { spacing: { top: "md" } },
    });
    expect(
      spaced.querySelector("[data-probe]")?.getAttribute("data-probe"),
    ).toBe("classic");
  });

  it("a display alone does not turn the legacy wrapper into a design frame", async () => {
    const container = await render1({
      id: "categories",
      type: "categories",
      visible: true,
      design: { display: { layout: "grid" } },
    });
    // Same wrapper an undesigned section gets: a plain div around the node.
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(
      container.firstElementChild?.firstElementChild?.getAttribute(
        "data-probe",
      ),
    ).toBe("grid");
  });
});
