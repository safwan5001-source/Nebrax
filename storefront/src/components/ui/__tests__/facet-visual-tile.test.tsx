import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedFacetVisual } from "@/lib/presentation/facet-visual";
import { FacetVisualTile } from "../facet-visual-tile";

const M1 = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const SRC = "/api/storefront/media/facet-visuals/v/m/thumb-160.webp";

const imageVisual: ResolvedFacetVisual = {
  content: "image",
  image: { mediaId: M1, fit: "cover", focal: { x: 30, y: 70 } },
  fallbackIcon: "gift",
  shape: "arch",
  size: "lg",
  showLabel: true,
};

function tile(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe("FacetVisualTile (VD-2)", () => {
  it("draws a decorative, lazy, pre-sized image framed by the shape", () => {
    const { container } = render(
      <FacetVisualTile
        visual={imageVisual}
        label="عيد ميلاد"
        image={{ src: SRC }}
      />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
    expect(img?.getAttribute("width")).toBe("112");
    expect(img?.style.objectPosition).toBe("30% 70%");
    const frame = img?.parentElement as HTMLElement;
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.style.aspectRatio).toBe("3 / 4");
    expect(tile(container).dataset.facetContent).toBe("image");
    expect(screen.getByText("عيد ميلاد").className).toContain("line-clamp-2");
  });

  it("never shows a broken image: a load error falls back to the icon, keeping shape and size", () => {
    const { container } = render(
      <FacetVisualTile
        visual={imageVisual}
        label="Birthday"
        image={{ src: SRC }}
      />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(tile(container).dataset.facetContent).toBe("icon");
    const frame = container.querySelector(
      "[aria-hidden='true']",
    ) as HTMLElement;
    expect(frame.style.aspectRatio).toBe("3 / 4");
    expect(frame.style.width).toBe("112px");
  });

  it("with no image source and no fallback icon it keeps the shaped frame with the name's initial", () => {
    const visual: ResolvedFacetVisual = {
      ...imageVisual,
      fallbackIcon: undefined,
      showLabel: false,
    };
    const { container } = render(
      <FacetVisualTile visual={visual} label="  زفاف" image={null} />,
    );
    expect(container.querySelector("img")).toBeNull();
    const frame = container.querySelector(
      "[aria-hidden='true']",
    ) as HTMLElement;
    // D-08: shape and size survive every fallback stage, so a grid row stays aligned.
    expect(frame.style.aspectRatio).toBe("3 / 4");
    expect(frame.style.width).toBe("112px");
    expect(frame.textContent).toBe("ز");
    // Nothing visual names the value, so the label is shown even though showLabel is false.
    expect(screen.getByText("زفاف").className).not.toContain("sr-only");
    expect(tile(container).dataset.facetContent).toBe("initial");
  });

  it("detects an image that failed before hydration (no onError replay) and falls back", () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const natural = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(0);
    const { container } = render(
      <FacetVisualTile visual={imageVisual} label="x" image={{ src: SRC }} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(tile(container).dataset.facetContent).toBe("icon");
    complete.mockRestore();
    natural.mockRestore();
  });

  it("keeps an image that loaded before hydration", () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const natural = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(160);
    const { container } = render(
      <FacetVisualTile visual={imageVisual} label="x" image={{ src: SRC }} />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    complete.mockRestore();
    natural.mockRestore();
  });

  it("requests a sharper variant for a zoomed image and survives an unknown size", () => {
    const { container, rerender } = render(
      <FacetVisualTile
        visual={{
          ...imageVisual,
          image: { mediaId: M1, fit: "cover", zoom: 2 },
        }}
        label="x"
        image={{ src: SRC }}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("sizes")).toBe("224px");
    rerender(
      <FacetVisualTile
        visual={
          { ...imageVisual, size: "xl" } as unknown as ResolvedFacetVisual
        }
        label="x"
        image={{ src: SRC }}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("width")).toBe("80");
  });

  it("never writes a non-hex background into CSS", () => {
    const visual = {
      ...imageVisual,
      background: "red;background-image:url(//x)",
    } as unknown as ResolvedFacetVisual;
    const { container } = render(
      <FacetVisualTile visual={visual} label="x" image={null} />,
    );
    expect(container.innerHTML).not.toContain("url(//x)");
  });

  it("a hidden label stays as the accessible name", () => {
    const visual: ResolvedFacetVisual = {
      content: "icon",
      icon: "cake",
      shape: "circle",
      size: "md",
      showLabel: false,
    };
    render(<FacetVisualTile visual={visual} label="تخرج" />);
    expect(screen.getByText("تخرج").className).toBe("sr-only");
  });

  it("applies a readable merchant icon colour and drops an unreadable one", () => {
    const readable: ResolvedFacetVisual = {
      content: "icon",
      icon: "cake",
      iconColor: "#9d2449",
      background: "#fdf2f4",
      shape: "rounded",
      size: "sm",
      showLabel: true,
    };
    const { container, rerender } = render(
      <FacetVisualTile visual={readable} label="x" />,
    );
    const iconWrap = () =>
      container.querySelector("svg")?.parentElement as HTMLElement;
    expect(iconWrap().style.color).toBe("rgb(157, 36, 73)");
    rerender(
      <FacetVisualTile
        visual={{ ...readable, iconColor: "#fef6f7" }}
        label="x"
      />,
    );
    // Unreadable on the merchant's own background: a guaranteed-readable colour, not the unknown theme primary.
    expect(iconWrap().style.color).toBe("rgb(17, 24, 39)");
    rerender(
      <FacetVisualTile
        visual={{ ...readable, iconColor: undefined, background: undefined }}
        label="x"
      />,
    );
    expect(iconWrap().style.color).toBe("var(--store-primary, currentColor)");
  });

  it("text-only content draws no frame", () => {
    const { container } = render(
      <FacetVisualTile
        visual={{
          content: "none",
          shape: "circle",
          size: "md",
          showLabel: true,
        }}
        label="أخرى"
      />,
    );
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("أخرى")).toBeTruthy();
  });

  it("an unknown icon key draws no glyph and never injects markup", () => {
    const visual = {
      content: "icon",
      icon: "<svg onload=alert(1)>",
      shape: "circle",
      size: "md",
      showLabel: true,
    } as unknown as ResolvedFacetVisual;
    const { container } = render(<FacetVisualTile visual={visual} label="x" />);
    expect(container.innerHTML).not.toContain("onload");
    expect(container.querySelector("svg")).toBeNull();
    expect(
      (container.querySelector("[aria-hidden='true']") as HTMLElement)
        .textContent,
    ).toBe("x");
    // The initial is decorative (inside the aria-hidden frame); the visible label stays the name.
    const [initial, name] = screen.getAllByText("x");
    expect(initial.closest("[aria-hidden='true']")).not.toBeNull();
    expect(name.className).not.toContain("sr-only");
  });
});
