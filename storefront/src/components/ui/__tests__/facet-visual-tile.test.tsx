import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  it("with no image source and no fallback icon it shows the name only", () => {
    const visual: ResolvedFacetVisual = {
      ...imageVisual,
      fallbackIcon: undefined,
      showLabel: false,
    };
    const { container } = render(
      <FacetVisualTile visual={visual} label="زفاف" image={null} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    // Nothing visual is left, so the label is shown even though showLabel is false.
    expect(screen.getByText("زفاف").className).not.toContain("sr-only");
    expect(tile(container).dataset.facetContent).toBe("none");
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

  it("an unknown icon key draws nothing rather than injecting markup", () => {
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
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("x").className).not.toContain("sr-only");
  });
});
