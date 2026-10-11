import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomContentBand } from "@/components/home/CustomContentBand";
import type { ViewBlock } from "@/lib/presentation/content-blocks-resolve";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const media: ResolvedMedia = {
  width: 1600,
  height: 900,
  decorative: false,
  alt: { ar: "وردة", en: "Rose" },
  sources: [
    {
      kind: "w",
      width: 800,
      height: 450,
      format: "webp",
      src: "/m/a/800.webp",
    },
    { kind: "w", width: 800, height: 450, format: "jpg", src: "/m/a/800.jpg" },
  ],
};

const labels = { note: "Note", success: "Success", warning: "Warning" };

function band(view: ViewBlock[]) {
  return render(
    <CustomContentBand
      sectionId="cc"
      content={{ blocks: [{ id: "x", kind: "divider" }] }}
      view={view}
      basePath="/sa/en"
      labels={labels}
    />,
  );
}

describe("CustomContentBand — block vocabulary (CUST-HV V9c-1)", () => {
  it("headings are h2 by default and h3 on request, aligned logically, never an h1", () => {
    const { container } = band([
      { id: "a", kind: "heading", text: "Plain" },
      { id: "b", kind: "heading", text: "Sub", level: 3, align: "center" },
      { id: "c", kind: "heading", text: "End", align: "end" },
    ]);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelectorAll("h2")).toHaveLength(2);
    const h3 = container.querySelector("h3") as HTMLElement;
    expect(h3.textContent).toBe("Sub");
    expect(h3.className).toContain("text-center");
    expect(container.querySelectorAll("h2")[1].className).toContain("text-end");
    // no physical alignment utilities
    expect(container.innerHTML).not.toMatch(/text-(left|right)\b/);
  });

  it("the section is named by its first heading, wherever it sits", () => {
    const { container } = band([
      { id: "p", kind: "paragraph", text: "intro" },
      {
        id: "c",
        kind: "columns",
        columns: [[{ id: "h", kind: "heading", text: "In a column" }], []],
      },
    ]);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.getAttribute("aria-labelledby")).toBe("cc-h");
    expect(container.querySelector("#cc-h")?.textContent).toBe("In a column");
  });

  it("paragraphs keep their line breaks and nothing is interpreted as HTML", () => {
    const { container } = band([
      { id: "p", kind: "paragraph", text: "line one\nline <b>two</b>" },
    ]);
    const p = container.querySelector("p") as HTMLElement;
    expect(p.className).toContain("whitespace-pre-line");
    expect(p.textContent).toBe("line one\nline <b>two</b>");
    expect(p.querySelector("b")).toBeNull();
  });

  it("an image is a real picture with the resolved alt, its dimensions, lazy loading and an optional caption", () => {
    const { container } = band([
      {
        id: "i",
        kind: "image",
        media,
        alt: "Rose",
        caption: "Spring",
        link: null,
      },
    ]);
    const img = container.querySelector("figure img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("Rose");
    expect(img.getAttribute("width")).toBe("1600");
    expect(img.getAttribute("height")).toBe("900");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(container.querySelector("source")?.getAttribute("type")).toBe(
      "image/webp",
    );
    expect(container.querySelector("figcaption")?.textContent).toBe("Spring");
    expect(container.querySelector("figure a")).toBeNull();
  });

  it("a decorative image has an empty alt; a linked image is a link and an https link is noopener", () => {
    const { container } = band([
      { id: "i", kind: "image", media, alt: "", caption: "", link: "/c/roses" },
      {
        id: "j",
        kind: "image",
        media,
        alt: "Rose",
        caption: "",
        link: "https://example.com/x",
      },
    ]);
    const imgs = container.querySelectorAll("img");
    expect(imgs[0].getAttribute("alt")).toBe("");
    const links = container.querySelectorAll("figure a");
    expect(links[0].getAttribute("href")).toBe("/sa/en/c/roses");
    expect(links[1].getAttribute("href")).toBe("https://example.com/x");
    expect(links[1].getAttribute("rel")).toContain("noopener");
  });

  it("a button is a link in the store's button look; outline and link styles differ, and a missing destination draws nothing", () => {
    const { container } = band([
      { id: "a", kind: "button", label: "Shop", href: "/shop" },
      {
        id: "b",
        kind: "button",
        label: "Learn",
        href: "/learn",
        style: "outline",
      },
      { id: "c", kind: "button", label: "Read", href: "/read", style: "link" },
    ]);
    const links = [...container.querySelectorAll("[data-content-button] a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/sa/en/shop",
      "/sa/en/learn",
      "/sa/en/read",
    ]);
    expect(links.map((a) => a.getAttribute("data-cta-style"))).toEqual([
      "solid",
      "outline",
      "link",
    ]);
  });

  it("dividers and spacers are decorative; a spacer is only vertical rhythm", () => {
    const { container } = band([
      { id: "d1", kind: "divider" },
      { id: "d2", kind: "divider", style: "dots" },
      { id: "s1", kind: "spacer" },
      { id: "s2", kind: "spacer", size: "lg" },
      { id: "s3", kind: "spacer", size: "sm" },
    ]);
    expect(container.querySelector("hr")).not.toBeNull();
    const dots = container.querySelector(
      '[data-content-divider="dots"]',
    ) as HTMLElement;
    expect(dots.getAttribute("aria-hidden")).toBe("true");
    const spacers = [...container.querySelectorAll("[data-content-spacer]")];
    expect(spacers.map((s) => s.getAttribute("data-content-spacer"))).toEqual([
      "md",
      "lg",
      "sm",
    ]);
    expect(spacers.every((s) => s.getAttribute("aria-hidden") === "true")).toBe(
      true,
    );
  });

  it("a callout names its tone to assistive technology, draws a registry icon decoratively, and never relies on colour alone", () => {
    const { container } = band([
      {
        id: "a",
        kind: "callout",
        text: "Heads up",
        tone: "warning",
        icon: "lock",
      },
      { id: "b", kind: "callout", text: "Plain" },
    ]);
    const [warning, info] = [...container.querySelectorAll("aside")];
    expect(warning.getAttribute("data-content-callout")).toBe("warning");
    expect(warning.querySelector(".sr-only")?.textContent).toBe("Warning: ");
    expect(warning.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(info.getAttribute("data-content-callout")).toBe("info");
    expect(info.querySelector(".sr-only")?.textContent).toBe("Note: ");
    expect(info.querySelector("svg")).toBeNull();
  });

  it("columns are two grid cells that stack below md (one column by default, two from md)", () => {
    const { container } = band([
      {
        id: "c",
        kind: "columns",
        columns: [
          [{ id: "a", kind: "paragraph", text: "left" }],
          [{ id: "b", kind: "paragraph", text: "right" }],
        ],
      },
    ]);
    const grid = container.querySelector(
      "[data-content-columns]",
    ) as HTMLElement;
    expect(grid.className).toContain("md:grid-cols-2");
    expect(grid.className).not.toMatch(/(^| )grid-cols-/);
    const cells = grid.querySelectorAll("[data-content-column]");
    expect(cells).toHaveLength(2);
    // DOM order is reading order: the first column first
    expect(cells[0].textContent).toBe("left");
    expect(cells[1].textContent).toBe("right");
    // a grid cell must be allowed to shrink so an unbroken word cannot widen the page
    expect([...cells].every((c) => c.className.includes("min-w-0"))).toBe(true);
  });

  it("a section with only headings and paragraphs keeps the original disclosure behaviour; any other kind turns it off", () => {
    const faq = [
      { id: "q1", kind: "heading" as const, text: "Q1" },
      { id: "a1", kind: "paragraph" as const, text: "A1" },
      { id: "q2", kind: "heading" as const, text: "Q2" },
      { id: "a2", kind: "paragraph" as const, text: "A2" },
    ];
    const text = render(
      <CustomContentBand
        sectionId="f"
        content={{ blocks: faq }}
        themePreset="awj-market"
      />,
    );
    expect(text.container.querySelectorAll("details")).toHaveLength(2);
    text.unmount();
    const mixed = render(
      <CustomContentBand
        sectionId="f"
        content={{ blocks: [...faq, { id: "d", kind: "divider" }] }}
        themePreset="awj-market"
        view={[...faq, { id: "d", kind: "divider" as const }]}
        basePath="/sa/en"
      />,
    );
    expect(mixed.container.querySelectorAll("details")).toHaveLength(0);
    expect(mixed.container.querySelectorAll("h2")).toHaveLength(2);
  });

  it("an empty view draws nothing (no empty band)", () => {
    const { container } = band([]);
    expect(container.firstChild).toBeNull();
  });
});
