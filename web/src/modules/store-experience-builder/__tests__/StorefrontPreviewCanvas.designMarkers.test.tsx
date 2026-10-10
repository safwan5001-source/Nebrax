/**
 * @vitest-environment jsdom
 *
 * CUST-HV V5c review — the empty banner placeholder carries the same content-box marker as
 * the authored banner, so designed inner spacing replaces (not doubles) its own padding.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

function banner(content: Record<string, string>): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        {
          id: "b1",
          type: "banner",
          visible: true,
          design: { spacing: { inner: "none" } },
          content: { title: "", subtitle: "", ctaLabel: "", ctaHref: "", imageUrl: "", ...content },
        },
      ],
    },
  } as StorefrontPresentationConfig;
}

describe("Canvas banner content-box marker", () => {
  afterEach(() => cleanup());

  it("marks the empty-state placeholder as the section content", () => {
    const { container } = render(
      <StorefrontPreviewCanvas config={banner({})} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const root = container.querySelector('[data-sd] > section');
    expect(root).not.toBeNull();
    expect(root?.querySelector(":scope > [data-section-content]")).not.toBeNull();
  });

  it("marks the authored content box too", () => {
    const { container } = render(
      <StorefrontPreviewCanvas config={banner({ title: "Hi" })} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    expect(container.querySelector("[data-sd] > section > [data-section-content]")).not.toBeNull();
  });

  it("benefits cards: legacy classes without a design, the published surface only with one", () => {
    const make = (design: unknown) =>
      ({
        ...DEFAULT_PRESENTATION_CONFIG,
        homepage: {
          ...DEFAULT_PRESENTATION_CONFIG.homepage,
          sections: [
            {
              id: "ben",
              type: "benefits",
              visible: true,
              design,
              content: { items: [{ id: "i", title: "A", body: "b" }] },
            },
          ],
        },
      }) as StorefrontPresentationConfig;
    const plain = render(
      <StorefrontPreviewCanvas config={make(undefined)} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    ).container;
    const plainCard = plain.querySelector("li") as HTMLElement;
    expect(plainCard.className).toContain("px-3 py-3");
    expect(plainCard.className).not.toContain("bg-store-surface");
    expect(plain.querySelector("[data-section-block]")).toBeNull();
    cleanup();
    const designed = render(
      <StorefrontPreviewCanvas
        config={make({ background: { kind: "solid", color: { hex: "#fde68a" } } })}
        locale="en"
        viewport="desktop"
        onSelectSection={() => {}}
      />,
    ).container;
    const card = designed.querySelector("li") as HTMLElement;
    expect(card.className).toContain("bg-store-surface px-4 py-4");
    expect(designed.querySelector("[data-section-block]")).not.toBeNull();
  });
});

describe("Canvas hero / banner placement and height (CUST-HV V6c-3)", () => {
  afterEach(() => cleanup());

  const withDesign = (type: "hero" | "banner"): StorefrontPresentationConfig =>
    ({
      ...DEFAULT_PRESENTATION_CONFIG,
      homepage: {
        ...DEFAULT_PRESENTATION_CONFIG.homepage,
        sections: [
          {
            id: "s1",
            type,
            visible: true,
            design: { align: "end", valign: "end", mediaTreatment: { height: "tall" } },
            ...(type === "banner"
              ? { content: { title: "Hi", subtitle: "", ctaLabel: "", ctaHref: "", imageUrl: null } }
              : { content: { headline: "Hi" } }),
          },
        ],
      },
    }) as StorefrontPresentationConfig;

  for (const type of ["hero", "banner"] as const) {
    it(`${type}: the frame carries the same tokens as the storefront, and the content box is the section's direct child`, () => {
      const { container } = render(
        <StorefrontPreviewCanvas config={withDesign(type)} locale="en" viewport="desktop" onSelectSection={() => {}} />,
      );
      const frame = container.querySelector("[data-sd]") as HTMLElement;
      expect(frame.getAttribute("data-sd")).toBe("balign valign hgt");
      expect(frame.style.getPropertyValue("--sec-vj")).toBe("flex-end");
      expect(frame.style.getPropertyValue("--sec-minh")).toBe("28rem");
      // the stylesheet's `[data-sd] > *` rules address the section root and its marked content box
      expect(frame.querySelector(":scope > section > [data-section-content]")).not.toBeNull();
    });
  }

  it("`screen` follows the simulated device height, not the editor window", () => {
    const config = withDesign("hero");
    (config.homepage.sections[0] as { design?: unknown }).design = { mediaTreatment: { height: "screen" } };
    const heights = (["mobile", "tablet", "desktop"] as const).map((viewport) => {
      const { container, unmount } = render(
        <StorefrontPreviewCanvas config={config} locale="en" viewport={viewport} onSelectSection={() => {}} />,
      );
      const value = (container.querySelector("[data-sd]") as HTMLElement).style.getPropertyValue("--sec-minh");
      unmount();
      return value;
    });
    expect(heights).toEqual(["clamp(24rem, 844px, 56rem)", "clamp(24rem, 1024px, 56rem)", "clamp(24rem, 800px, 56rem)"]);
  });

  it("a hero or banner with no design is untouched: no frame, no attribute", () => {
    const config = withDesign("hero");
    (config.homepage.sections[0] as { design?: unknown }).design = undefined;
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    expect(container.querySelector("[data-sd]")).toBeNull();
  });
});

describe("Canvas hero overlap (CUST-HV V6c-4)", () => {
  afterEach(() => cleanup());

  it("never emits the overlap marker without a proven picture, and the phone frame is told its width", () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      homepage: {
        ...DEFAULT_PRESENTATION_CONFIG.homepage,
        sections: [{ id: "h1", type: "hero", visible: true, design: { overlap: "md" }, content: { headline: "Hi" } }],
      },
    } as StorefrontPresentationConfig;
    for (const viewport of ["mobile", "tablet", "desktop"] as const) {
      const { container, unmount } = render(
        <StorefrontPreviewCanvas config={config} locale="en" viewport={viewport} onSelectSection={() => {}} />,
      );
      // no picture to prove ⇒ no overlap, in any frame
      expect(container.querySelector("[data-sd~='ovlp']")).toBeNull();
      unmount();
    }
  });
});
