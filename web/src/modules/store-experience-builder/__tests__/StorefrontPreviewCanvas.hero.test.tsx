/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6a (V0 §8.1–8.2) — the Canvas shows what the storefront publishes: each hero from its own
 * content (legacy globals while it has none), the first visible hero as the page's only <h1>, any
 * further one as an <h2>, and a visually-hidden <h1> naming the store when no hero is visible.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationHomeSection,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

afterEach(cleanup);

const canvas = (
  sections: PresentationHomeSection[],
  homepage: Partial<StorefrontPresentationConfig["homepage"]> = {},
) =>
  render(
    <StorefrontPreviewCanvas
      config={{
        ...DEFAULT_PRESENTATION_CONFIG,
        homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, ...homepage, sections },
      }}
      locale="en"
      viewport="desktop"
      liveStoreName="Daisy Shop"
      onSelectSection={() => {}}
    />,
  ).container;

const homeH1 = (container: HTMLElement) =>
  [...container.querySelectorAll("h1")].filter(
    (h) => h.hasAttribute("data-preview-hero-heading") || h.hasAttribute("data-preview-store-heading"),
  );

describe("Canvas heroes (CUST-HV V6a)", () => {
  it("a hero without content reads the legacy globals, as before", () => {
    const c = canvas([{ id: "hero", type: "hero", visible: true }], {
      heroHeadline: "Legacy headline",
      heroSubheadline: "Legacy line",
    });
    expect(c.querySelector("[data-preview-hero-heading]")?.textContent).toBe("Legacy headline");
    expect(c.textContent).toContain("Legacy line");
    expect(c.querySelector("[data-preview-hero-cta]")).toBeNull(); // default CTA only
  });

  it("each hero renders its own content; the first visible is the only <h1>, the rest <h2>", () => {
    const c = canvas(
      [
        { id: "hero-off", type: "hero", visible: false, content: { headline: "Hidden" } },
        { id: "hero", type: "hero", visible: true, content: { headline: "First", subheadline: "One" } },
        { id: "hero-2", type: "hero", visible: true, content: { headline: "Second" } },
      ],
      { heroHeadline: "ignored legacy" },
    );
    const headings = [...c.querySelectorAll("[data-preview-hero-heading]")];
    expect(headings.map((h) => [h.tagName, h.textContent])).toEqual([
      ["H1", "First"],
      ["H2", "Second"],
    ]);
    expect(homeH1(c)).toHaveLength(1);
    expect(c.textContent).not.toContain("Hidden");
    expect(c.textContent).not.toContain("ignored legacy");
  });

  it("an explicitly empty headline shows the store name, and only complete buttons render", () => {
    const c = canvas([
      {
        id: "hero",
        type: "hero",
        visible: true,
        content: {
          headline: "",
          ctas: [
            { label: "Shop now", href: "/collections/new" },
            { label: "Draft without a link", href: "" },
          ],
        },
      },
    ]);
    expect(c.querySelector("[data-preview-hero-heading]")?.textContent).toBe("Daisy Shop");
    const ctas = [...c.querySelectorAll("[data-preview-hero-cta]")];
    expect(ctas.map((e) => [e.getAttribute("data-preview-hero-cta"), e.textContent])).toEqual([
      ["primary", "Shop now"],
    ]);
  });

  it("incomplete buttons are not shown and do NOT bring the default CTA back (that is for a hero with no buttons)", () => {
    const c = canvas([
      {
        id: "hero",
        type: "hero",
        visible: true,
        content: { headline: "H", ctas: [{ label: "Cleared link", href: "" }] },
      },
    ]);
    expect(c.querySelector("[data-preview-hero-cta]")).toBeNull();
    expect(c.textContent).not.toContain("Shop all");
    expect(c.textContent).not.toContain("Cleared link");
    cleanup();
    const none = canvas([{ id: "hero", type: "hero", visible: true, content: { headline: "H" } }]);
    expect(none.textContent).toContain("Shop all");
  });

  it("with no visible hero the store is named in a visually-hidden <h1> (exactly one <h1>)", () => {
    const c = canvas([
      { id: "hero", type: "hero", visible: false },
      { id: "cats", type: "categories", visible: true },
    ]);
    const h1 = homeH1(c);
    expect(h1).toHaveLength(1);
    expect(h1[0].className).toContain("sr-only");
    expect(h1[0].textContent).toBe("Daisy Shop");
    cleanup();
    const none = canvas([{ id: "cats", type: "categories", visible: true }]);
    expect(homeH1(none)).toHaveLength(1);
  });

  it("with a visible hero there is no hidden store <h1>", () => {
    const c = canvas([{ id: "hero", type: "hero", visible: true }]);
    expect(c.querySelector("[data-preview-store-heading]")).toBeNull();
    expect(homeH1(c)).toHaveLength(1);
  });
});

describe("Canvas CTA styles (CUST-HV V6c-5)", () => {
  it("hero: absent style ⇒ by position; an explicit style wins per button (same looks as the storefront)", () => {
    const c = canvas([
      {
        id: "hero",
        type: "hero",
        visible: true,
        content: {
          headline: "H",
          ctas: [
            { label: "A", href: "/a", style: "link" },
            { label: "B", href: "/b" },
          ],
        },
      },
    ]);
    const [a, b] = [...c.querySelectorAll("[data-preview-hero-cta]")];
    expect(a.getAttribute("data-cta-style")).toBe("link");
    expect(a.className).toContain("underline");
    expect(a.className).not.toContain("bg-store-primary-foreground");
    expect(b.getAttribute("data-cta-style")).toBe("outline");
    expect(b.className).toContain("border-store-primary-foreground/70");
  });

  it("banner: styles map to the same looks, and only the outline look is the shared Button's outline variant", () => {
    const c = canvas([
      {
        id: "ban",
        type: "banner",
        visible: true,
        content: {
          title: "T",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: null,
          ctas: [
            { label: "A", href: "/a", style: "outline" },
            { label: "B", href: "/b", style: "link" },
          ],
        },
      },
    ]);
    const [a, b] = [...c.querySelectorAll("[data-banner-cta]")];
    expect(a.getAttribute("data-cta-style")).toBe("outline");
    expect(a.getAttribute("data-slot")).toBe("button");
    expect(b.getAttribute("data-cta-style")).toBe("link");
    expect(b.getAttribute("data-slot")).toBeNull();
    expect(b.className).toContain("underline");
  });
});
