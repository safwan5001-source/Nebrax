/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6c-2 (V0 §8.2) — a banner renders its `ctas` (≤2) or, while it has none, the legacy
 * `ctaLabel/ctaHref` pair as `ctas[0]`. Only a COMPLETE button renders; an incomplete draft never borrows
 * another's link; a single button keeps its pre-V6c-2 markup exactly.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { publishedNodes } from "../published-nodes";

afterEach(cleanup);

const ctx = {
  implemented: {},
  basePath: "/sa/en",
  locale: "en",
  themePreset: undefined,
  apps: { iosUrl: "", androidUrl: "", appName: "" },
  benefitsTitle: "b",
  featuredTitle: "f",
  offersTitle: "o",
  appTitle: "a",
  appStoreLabel: "as",
  playStoreLabel: "ps",
  design: { primaryColor: "#12372a", accentColor: null, dir: "ltr" as const },
};

const banner = (content: Record<string, unknown>): PresentationHomeSection =>
  ({
    id: "ban",
    type: "banner",
    visible: true,
    content: {
      title: "Winter sale",
      subtitle: "",
      ctaLabel: "",
      ctaHref: "",
      imageUrl: null,
      ...content,
    },
  }) as PresentationHomeSection;

async function mount(section: PresentationHomeSection) {
  const nodes = await publishedNodes([section], ctx as never);
  return render(<div>{nodes}</div>).container;
}

const links = (c: HTMLElement) =>
  [...c.querySelectorAll("section a")].map((a) => ({
    text: a.textContent,
    href: a.getAttribute("href"),
    cls: a.getAttribute("class") ?? "",
  }));

const SINGLE_CLASS =
  "mt-4 inline-flex h-10 max-w-full items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground";

describe("Banner CTAs (CUST-HV V6c-2)", () => {
  it("the legacy pair renders as one link with the single-button classes and no wrapper", async () => {
    const c = await mount(banner({ ctaLabel: "Shop", ctaHref: "/products" }));
    expect(links(c)).toEqual([
      { text: "Shop", href: "/sa/en/products", cls: SINGLE_CLASS },
    ]);
    expect(c.querySelector("section .flex-wrap")).toBeNull();
  });

  it("a single authored CTA is byte-identical to the legacy single button", async () => {
    const legacy = await mount(
      banner({ ctaLabel: "Shop", ctaHref: "/products" }),
    );
    const legacyHtml = legacy.innerHTML;
    cleanup();
    const authored = await mount(
      banner({ ctas: [{ label: "Shop", href: "/products" }] }),
    );
    expect(authored.innerHTML).toBe(legacyHtml);
  });

  it("two CTAs render in order inside one wrapper: a brand primary and an outline secondary", async () => {
    const c = await mount(
      banner({
        ctas: [
          { label: "Shop now", href: "/products" },
          { label: "Learn more", href: "https://example.com/about" },
        ],
      }),
    );
    const rendered = links(c);
    expect(rendered.map((l) => [l.text, l.href])).toEqual([
      ["Shop now", "/sa/en/products"],
      ["Learn more", "https://example.com/about"],
    ]);
    expect(rendered[0].cls).toContain("bg-store-primary");
    expect(rendered[1].cls).toContain("border-2");
    expect(rendered[1].cls).toContain("text-store-foreground");
    expect(rendered[1].cls).not.toContain("bg-store-primary");
    expect(c.querySelectorAll("section .flex-wrap")).toHaveLength(1);
  });

  it("the second button joins the global button tokens as an outline button; the first is the store's solid CTA", async () => {
    const c = await mount(
      banner({
        ctas: [
          { label: "A", href: "/a" },
          { label: "B", href: "/b" },
        ],
      }),
    );
    const [first, second] = [...c.querySelectorAll("section a")];
    // reached by the stylesheet's size / radius / weight / case rules (V5e-2b), not by its colour rules
    const reach =
      '[data-slot="button"]:is([data-variant="default"], [data-variant="outline"], [data-variant="secondary"]):not([data-size^="icon"])';
    expect(second.matches(reach)).toBe(true);
    expect(second.matches('[data-variant="default"]')).toBe(false);
    expect(
      first.matches(
        '[class~="bg-store-primary"][class~="rounded-store"][class~="font-bold"]',
      ),
    ).toBe(true);
    expect(first.hasAttribute("data-slot")).toBe(false);
  });

  it("`ctas` wins over a stale legacy pair", async () => {
    const c = await mount(
      banner({
        ctaLabel: "Old",
        ctaHref: "/old",
        ctas: [{ label: "New", href: "/new" }],
      }),
    );
    expect(links(c).map((l) => [l.text, l.href])).toEqual([
      ["New", "/sa/en/new"],
    ]);
  });

  it("an incomplete draft button is skipped and never borrows another's link", async () => {
    const c = await mount(
      banner({
        ctas: [
          { label: "No link", href: "" },
          { label: "", href: "/orphan" },
          { label: "Complete", href: "/ok" },
        ],
      }),
    );
    // (publishedNodes renders the document as given; the ≤2 cap is the normaliser's job)
    expect(links(c).map((l) => l.text)).toEqual(["Complete"]);
    expect(c.querySelector("section .flex-wrap")).toBeNull(); // one complete button ⇒ the single-button markup
  });

  it("the label is trimmed at render", async () => {
    const c = await mount(
      banner({ ctas: [{ label: "  Shop  ", href: "/p" }] }),
    );
    expect(links(c)[0].text).toBe("Shop");
  });

  it("a banner whose only content is a button label still renders, with the label as its accessible heading", async () => {
    const c = await mount(
      banner({ title: "", ctas: [{ label: "Shop", href: "/p" }] }),
    );
    expect(c.querySelector("section h2.sr-only")?.textContent).toBe("Shop");
    expect(links(c)).toHaveLength(1);
  });

  it("a banner with no title/subtitle/image and no labelled button is omitted", async () => {
    const c = await mount(
      banner({ title: "", ctas: [{ label: "", href: "/p" }] }),
    );
    expect(c.querySelector("section")).toBeNull();
  });
});

describe("Banner CTA styles (CUST-HV V6c-5)", () => {
  const two = (a?: string, b?: string) =>
    banner({
      ctas: [
        { label: "Shop", href: "/products", ...(a ? { style: a } : {}) },
        { label: "More", href: "/about", ...(b ? { style: b } : {}) },
      ],
    });
  const styles = (c: HTMLElement) =>
    [...c.querySelectorAll("section a")].map((a) =>
      a.getAttribute("data-cta-style"),
    );

  it("absent style ⇒ by position: first solid, second outline (exactly the classes they always had)", async () => {
    const c = await mount(two());
    expect(styles(c)).toEqual(["solid", "outline"]);
    const [first, second] = [...c.querySelectorAll("section a")];
    expect(first.getAttribute("class")).toContain("bg-store-primary");
    expect(second.getAttribute("class")).toContain(
      "border-store-foreground/60",
    );
    expect(second.getAttribute("data-slot")).toBe("button");
    expect(second.getAttribute("data-variant")).toBe("outline");
  });

  it("an explicit style wins over position, per button", async () => {
    const c = await mount(two("link", "solid"));
    expect(styles(c)).toEqual(["link", "solid"]);
    const [first, second] = [...c.querySelectorAll("section a")];
    expect(first.getAttribute("class")).toContain("underline");
    expect(first.getAttribute("class")).not.toContain("bg-store-primary");
    expect(first.getAttribute("data-slot")).toBeNull(); // a text link is not a global-token button
    expect(second.getAttribute("class")).toContain("bg-store-primary");
    expect(second.getAttribute("data-slot")).toBeNull();
  });

  it("a single button can be outline or link; link keeps the 40px tap height and colours itself in the heading colour", async () => {
    const outline = await mount(
      banner({ ctas: [{ label: "Go", href: "/go", style: "outline" }] }),
    );
    expect(styles(outline)).toEqual(["outline"]);
    expect(outline.querySelector("section a")?.getAttribute("class")).toMatch(
      /^mt-4 /,
    );
    const link = await mount(
      banner({ ctas: [{ label: "Go", href: "/go", style: "link" }] }),
    );
    const cls = link.querySelector("section a")?.getAttribute("class") ?? "";
    expect(cls).toContain("h-10");
    expect(cls).toContain("text-store-foreground");
    expect(cls).toMatch(/^mt-4 /);
  });
});
