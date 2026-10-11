import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_KEYS, ICON_REGISTRY } from "@/lib/presentation/icon-registry";
import { ICON_GLYPHS, StoreIcon } from "../store-icon";

describe("StoreIcon (V7d-1)", () => {
  it("draws every registry key, decorative by default", () => {
    expect(Object.keys(ICON_GLYPHS).sort()).toEqual([...ICON_KEYS].sort());
    for (const key of ICON_KEYS) {
      const { container, unmount } = render(<StoreIcon name={key} />);
      const svg = container.querySelector("svg");
      expect(svg, key).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("role")).toBeNull();
      unmount();
    }
  });

  it("an icon used alone takes a text alternative and becomes an image", () => {
    const { container } = render(<StoreIcon name="phone" label="Call us" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Call us");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
  });

  it("an unknown key draws nothing", () => {
    for (const bad of ["nope", "<svg/>", undefined, null, 3]) {
      const { container, unmount } = render(<StoreIcon name={bad} />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });

  it("directional glyphs mirror under RTL, the rest do not", () => {
    for (const key of ICON_KEYS) {
      const { container, unmount } = render(<StoreIcon name={key} />);
      const mirrored = (
        container.querySelector("svg")?.getAttribute("class") ?? ""
      ).includes("rtl:-scale-x-100");
      expect(mirrored, key).toBe(ICON_REGISTRY[key].directional);
      unmount();
    }
  });
});
