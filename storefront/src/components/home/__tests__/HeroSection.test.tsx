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
});
