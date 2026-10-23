import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const t = (key: string, values?: { storeName?: string }) => {
      if (key === "welcome") return values?.storeName ?? "";
      if (key === "heroDescription")
        return `Browse the published catalog for ${values?.storeName}.`;
      if (key === "shopNow") return "Shop all products";
      if (key === "shop") return "Shop";
      if (key === "welcomeEyebrow") return "Welcome";
      return key;
    };
    return t;
  }),
}));

describe("HeroSection (COM-7-P3A)", () => {
  it("renders the resolved store name and has no Spree demo links", async () => {
    const { HeroSection } = await import("../HeroSection");
    const element = await HeroSection({
      basePath: "/sa/ar",
      locale: "ar",
      storeName: "شركة دمينة للاستيراد والتصدير",
    });
    const { getByText, container } = render(element);

    expect(getByText("شركة دمينة للاستيراد والتصدير")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Fork on GitHub/i);
    expect(container.textContent).not.toMatch(/Quickstart/i);
    expect(container.innerHTML).not.toMatch(/github.com\/spree/);
    expect(container.innerHTML).not.toMatch(/spreecommerce.org/);
    expect(container.querySelector('a[href="/sa/ar/products"]')).toBeTruthy();
  });

  it("uses the generic fallback when the resolved name is missing", async () => {
    const { HeroSection } = await import("../HeroSection");
    const element = await HeroSection({
      basePath: "/sa/en",
      locale: "en",
      storeName: null,
    });
    const { getByText, queryByText } = render(element);

    expect(getByText("Shop")).toBeTruthy();
    expect(queryByText("Spree Store")).toBeNull();
    expect(queryByText("Store")).toBeNull();
  });

  it("shrinks the band under AWJ Market so discovery, not the masthead, dominates the fold", async () => {
    const { HeroSection } = await import("../HeroSection");

    const marketEl = await HeroSection({
      basePath: "/sa/ar",
      locale: "ar",
      storeName: "متجر",
      themePreset: "awj-market",
    });
    const market = render(marketEl);
    expect(market.container.querySelector("section")?.className).toContain(
      "min-h-[7rem]",
    );
    market.unmount();

    const modernEl = await HeroSection({
      basePath: "/sa/ar",
      locale: "ar",
      storeName: "متجر",
    });
    const modern = render(modernEl);
    // Unchanged from before this Horizon — no theme regression.
    expect(modern.container.querySelector("section")?.className).toContain(
      "min-h-[11rem]",
    );
  });

  describe("per-instance hero (CUST-HV V6a)", () => {
    it("keeps today's markup: an <h1 id=home-hero> and the one default CTA", async () => {
      const { HeroSection } = await import("../HeroSection");
      const { container } = render(
        await HeroSection({
          basePath: "/sa/en",
          locale: "en",
          storeName: "Shop",
        }),
      );
      const h1 = container.querySelector("h1#home-hero");
      expect(h1).toBeTruthy();
      expect(
        container.querySelector("section")?.getAttribute("aria-labelledby"),
      ).toBe("home-hero");
      expect(container.querySelectorAll("a")).toHaveLength(1);
      expect(container.querySelector("[data-hero-cta]")).toBeNull();
    });

    it("a further hero is an <h2> with its own id (one <h1> per page)", async () => {
      const { HeroSection } = await import("../HeroSection");
      const { container } = render(
        await HeroSection({
          basePath: "/sa/en",
          locale: "en",
          storeName: "Shop",
          headline: "Second",
          headingId: "home-hero-two",
          headingLevel: 2,
        }),
      );
      expect(container.querySelector("h1")).toBeNull();
      const h2 = container.querySelector("h2#home-hero-two");
      expect(h2?.textContent).toBe("Second");
      expect(
        container.querySelector("section")?.getAttribute("aria-labelledby"),
      ).toBe("home-hero-two");
    });

    it("authored CTAs replace the default one: primary then secondary, store-path hrefs prefixed", async () => {
      const { HeroSection } = await import("../HeroSection");
      const { container } = render(
        await HeroSection({
          basePath: "/sa/en",
          locale: "en",
          storeName: "Shop",
          ctas: [
            { label: "New in", href: "/collections/new" },
            { label: "Our story", href: "https://example.com/about" },
          ],
        }),
      );
      const links = [...container.querySelectorAll("a")];
      expect(
        links.map((a) => [
          a.textContent,
          a.getAttribute("href"),
          a.getAttribute("data-hero-cta"),
        ]),
      ).toEqual([
        ["New in", "/sa/en/collections/new", "primary"],
        ["Our story", "https://example.com/about", "secondary"],
      ]);
      expect(container.querySelector('a[href="/sa/en/products"]')).toBeNull();
    });

    it("CUST-HV V6c-5: absent style ⇒ by position; an explicit style wins per button, in the section's own colours", async () => {
      const { HeroSection } = await import("../HeroSection");
      const render2 = async (ctas: Array<Record<string, string>>) =>
        render(
          await HeroSection({
            basePath: "/sa/en",
            locale: "en",
            storeName: "Shop",
            ctas: ctas as never,
          }),
        ).container;
      const a = await render2([
        { label: "A", href: "/a" },
        { label: "B", href: "/b" },
      ]);
      expect(
        [...a.querySelectorAll("a")].map((e) =>
          e.getAttribute("data-cta-style"),
        ),
      ).toEqual(["solid", "outline"]);
      const [solid, outline] = [...a.querySelectorAll("a")];
      expect(solid.className).toContain("bg-store-primary-foreground");
      expect(outline.className).toContain("border-store-primary-foreground/70");
      const b = await render2([
        { label: "A", href: "/a", style: "link" },
        { label: "B", href: "/b", style: "solid" },
      ]);
      const [link, second] = [...b.querySelectorAll("a")];
      expect(link.getAttribute("data-cta-style")).toBe("link");
      expect(link.className).toContain("underline");
      expect(link.className).toContain("text-store-primary-foreground");
      expect(link.className).not.toContain("bg-store-primary-foreground");
      expect(link.className).toContain("md:h-11"); // the tap height stays
      expect(second.className).toContain("bg-store-primary-foreground");
      // the data hook keeps its positional meaning (primary / secondary), the look does not
      expect(link.getAttribute("data-hero-cta")).toBe("primary");
    });

    it("CUST-HV V6c-6: an explicit colour paints the button from validated custom properties (role colour → hex), only with a palette context", async () => {
      const { HeroSection } = await import("../HeroSection");
      const design = {
        primaryColor: "#12372a",
        accentColor: "#ffd166",
        dir: "ltr" as const,
      };
      const ctas = [
        { label: "A", href: "/a", style: "solid", colour: "accent" },
        { label: "B", href: "/b", style: "link", colour: "text" },
        { label: "C", href: "/c", style: "outline", colour: "brand" },
      ];
      const painted = render(
        await HeroSection({
          basePath: "/sa/en",
          locale: "en",
          storeName: "Shop",
          ctas: ctas.slice(0, 2) as never,
          designCtx: design,
        }),
      ).container;
      const [a, b] = [...painted.querySelectorAll("a")] as HTMLElement[];
      expect(a.getAttribute("data-cta-colour")).toBe("accent");
      expect(a.style.getPropertyValue("--cta-fill")).toBe("#ffd166");
      expect(a.style.getPropertyValue("--cta-label")).toBe("#000000"); // computed over its own fill
      expect(a.className).toContain("bg-(color:--cta-fill)");
      expect(a.className).not.toContain("bg-store-primary-foreground");
      expect(b.style.getPropertyValue("--cta-fill")).toBe("transparent");
      expect(b.style.getPropertyValue("--cta-label")).toBe("#111827");
      expect(b.className).toContain("underline");
      // without the palette context the colour is not painted: the style's own look stays
      const plain = render(
        await HeroSection({
          basePath: "/sa/en",
          locale: "en",
          storeName: "Shop",
          ctas: ctas.slice(2) as never,
        }),
      ).container;
      const c = plain.querySelector("a") as HTMLElement;
      expect(c.getAttribute("data-cta-colour")).toBeNull();
      expect(c.getAttribute("style")).toBeNull();
    });

    it("authored buttons that cannot render (no resolvable link) show NO button — the default link only belongs to a hero with no buttons", async () => {
      const { HeroSection } = await import("../HeroSection");
      const { container } = render(
        await HeroSection({
          basePath: "/sa/en",
          locale: "en",
          storeName: "Shop",
          ctas: [
            { label: "Bad", href: "javascript:alert(1)" },
            { label: "Cleared link", href: "" },
          ],
        }),
      );
      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector('a[href="/sa/en/products"]')).toBeNull();
      expect(container.textContent).not.toContain("Bad");
    });

    it("an empty ctas list is the same as none: the default CTA", async () => {
      const { HeroSection } = await import("../HeroSection");
      const { container } = render(
        await HeroSection({
          basePath: "/sa/en",
          locale: "en",
          storeName: "Shop",
          ctas: [],
        }),
      );
      expect(container.querySelector('a[href="/sa/en/products"]')).toBeTruthy();
    });
  });

  describe("display options (AWJ-HERO-DISPLAY)", () => {
    const base = {
      basePath: "/sa/en",
      locale: "en",
      storeName: "Shop",
      headline: "Welcome",
      subheadline: "Fresh daily",
      ctas: [{ label: "Browse", href: "/collections/new" }],
    };
    const render_ = async (extra: Record<string, unknown> = {}) => {
      const { HeroSection } = await import("../HeroSection");
      return render(
        await HeroSection({
          ...base,
          ...extra,
          backdrop: extra.backdrop ?? undefined,
        } as Parameters<typeof HeroSection>[0]),
      ).container;
    };
    const visible = (container: HTMLElement) => ({
      // the sr-only heading is hidden from sight, so it never counts as "visible title"
      title: container.querySelector("h1:not(.sr-only)") !== null,
      description: container.querySelector("p") !== null,
      button: container.querySelector("a") !== null,
    });

    // The five combinations the merchant can build: image only · +title · +title+description · +title+button · all.
    const combos: Array<
      [string, Record<string, boolean>, ReturnType<typeof visible>]
    > = [
      [
        "image only",
        { showTitle: false, showSubheadline: false, showCtas: false },
        { title: false, description: false, button: false },
      ],
      [
        "image + title",
        { showTitle: true, showSubheadline: false, showCtas: false },
        { title: true, description: false, button: false },
      ],
      [
        "image + title + description",
        { showTitle: true, showSubheadline: true, showCtas: false },
        { title: true, description: true, button: false },
      ],
      [
        "image + title + button",
        { showTitle: true, showSubheadline: false, showCtas: true },
        { title: true, description: false, button: true },
      ],
      [
        "image + title + description + button",
        { showTitle: true, showSubheadline: true, showCtas: true },
        { title: true, description: true, button: true },
      ],
    ];
    for (const [name, flags, expected] of combos) {
      it(`${name}: shows exactly the chosen parts and nothing else`, async () => {
        const container = await render_(flags);
        expect(visible(container)).toEqual(expected);
        // no empty wrapper: the content box exists only while something is drawn in it
        const box = container.querySelector("[data-section-content]");
        const anything =
          expected.title || expected.description || expected.button;
        expect(container.querySelector("section > div") !== null).toBe(
          anything,
        );
        if (box) expect(box.children.length).toBeGreaterThan(0);
      });
    }

    it("image only keeps the page's one heading for assistive technology, visually hidden", async () => {
      const container = await render_({
        showTitle: false,
        showSubheadline: false,
        showCtas: false,
      });
      const h1 = container.querySelector("h1#home-hero");
      expect(h1?.className).toContain("sr-only");
      expect(h1?.textContent).toBe("Welcome");
      expect(
        container.querySelector("section")?.getAttribute("aria-labelledby"),
      ).toBe("home-hero");
      expect(container.querySelector("section")?.children).toHaveLength(1);
    });

    it("hiding the buttons also hides the default 'shop now'", async () => {
      const container = await render_({ ctas: null, showCtas: false });
      expect(container.querySelector("a")).toBeNull();
      const shown = await render_({ ctas: null });
      expect(shown.querySelector('a[href="/sa/en/products"]')).toBeTruthy();
    });

    it("every switch defaulting to shown renders byte-for-byte what it rendered before the options existed", async () => {
      const explicit = await render_({
        showTitle: true,
        showSubheadline: true,
        showCtas: true,
        imageHref: null,
      });
      const legacy = await render_();
      expect(explicit.innerHTML).toBe(legacy.innerHTML);
    });

    it("a hidden description does not leave an empty paragraph, even with copy authored", async () => {
      const container = await render_({ showSubheadline: false });
      expect(container.querySelector("p")).toBeNull();
      expect(container.textContent).not.toContain("Fresh daily");
    });

    describe("clickable image", () => {
      const backdrop = <div data-sd-backdrop="" aria-hidden="true" />;

      it("links the picture to a store path, keeping the buttons clickable", async () => {
        const container = await render_({
          backdrop,
          designed: true,
          imageHref: "/collections/new",
        });
        const link = container.querySelector("a[data-hero-image-link]");
        expect(link?.getAttribute("href")).toBe("/sa/en/collections/new");
        expect(link?.getAttribute("aria-label")).toBe("Welcome");
        // the link sits above the picture and below the copy; the copy lets clicks through except on its own links
        const section = container.querySelector("section");
        expect(section?.className).toContain("relative");
        // above the picture (so its focus ring is painted over it), below the copy (later in the DOM)
        const order = [...(section?.children ?? [])];
        expect(order.indexOf(link as Element)).toBe(
          order.findIndex((el) => el.hasAttribute("data-sd-backdrop")) + 1,
        );
        expect(order.indexOf(link as Element)).toBeLessThan(
          order.findIndex((el) => el.hasAttribute("data-section-content")),
        );
        expect(
          container.querySelector("[data-section-content]")?.className,
        ).toContain("pointer-events-none");
        expect(container.querySelector("a[data-hero-cta]")).toBeTruthy();
      });

      it("works for an image-only hero and passes an https link through", async () => {
        const container = await render_({
          backdrop,
          imageHref: "https://example.com/sale",
          designed: true,
          showTitle: false,
          showSubheadline: false,
          showCtas: false,
        });
        expect(container.querySelectorAll("a")).toHaveLength(1);
        expect(
          container
            .querySelector("a[data-hero-image-link]")
            ?.getAttribute("href"),
        ).toBe("https://example.com/sale");
        expect(container.querySelector("[data-section-content]")).toBeNull();
      });

      it("is not a link without a picture, or without a link", async () => {
        const noPicture = await render_({ imageHref: "/collections/new" });
        expect(noPicture.querySelector("[data-hero-image-link]")).toBeNull();
        const noLink = await render_({ backdrop });
        expect(noLink.querySelector("[data-hero-image-link]")).toBeNull();
        expect(noLink.querySelector("section")?.className).not.toContain(
          "relative",
        );
      });

      it("its focus indicator is the two-colour ring in the stylesheet, not a single-colour outline utility (review on #1645)", async () => {
        const container = await render_({
          backdrop,
          imageHref: "/collections/new",
        });
        const link = container.querySelector("a[data-hero-image-link]");
        // no outline colour utility on the element: a text/brand colour could vanish on the picture, and the
        // section frame recolours `focus-visible:outline-store-*` indicators to the section foreground
        expect(link?.className ?? "").not.toMatch(/outline/);
      });

      it("an unsafe link is never rendered", async () => {
        const container = await render_({
          backdrop,
          imageHref: "javascript:alert(1)",
        });
        expect(container.querySelector("[data-hero-image-link]")).toBeNull();
      });
    });
  });
});
