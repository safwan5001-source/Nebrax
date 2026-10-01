/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

/**
 * CUST-H3-2 — `fontPreset` becomes an actual Canvas font stack instead of a
 * literal "Cairo"/"Geist" string the browser substitutes for. `cairo-geist`
 * must keep resolving to the same stack as before (no visual regression);
 * `tajawal-geist` must resolve to a visibly different stack immediately,
 * with Home/Product/Category all reading the same global `config.fontPreset`
 * — never a per-page font.
 */
describe("Customizer Canvas — Typography runtime (CUST-H3-2)", () => {
  afterEach(() => {
    cleanup();
  });

  it("cairo-geist resolves to the Geist/Cairo stack (unchanged default behavior)", () => {
    const { container } = render(
      <StorefrontPreviewCanvas config={DEFAULT_PRESENTATION_CONFIG} locale="en" viewport="desktop" />,
    );
    const canvas = container.querySelector("[data-preview-canvas]") as HTMLElement;
    expect(canvas.style.fontFamily).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );
  });

  it("tajawal-geist immediately resolves to the Geist/Tajawal stack", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, fontPreset: "tajawal-geist" as const };
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" />,
    );
    const canvas = container.querySelector("[data-preview-canvas]") as HTMLElement;
    // CUST-H3-2-FIX-1: must use the dedicated Tajawal-fallback Geist
    // instance (`--font-geist-tajawal`), never the shared `--font-geist` —
    // that instance's own fallback names Cairo and would shadow Tajawal.
    expect(canvas.style.fontFamily).toBe(
      "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif",
    );
    expect(canvas.style.fontFamily).not.toContain("--font-cairo");
  });

  it("an unknown/stale fontPreset fails closed to the Cairo stack", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, fontPreset: "helvetica-geist" as never };
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" />,
    );
    const canvas = container.querySelector("[data-preview-canvas]") as HTMLElement;
    expect(canvas.style.fontFamily).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );
  });

  it("the same global font applies across Home, Product and Category pages", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, fontPreset: "tajawal-geist" as const };
    for (const page of ["home", "product", "category"] as const) {
      const { container, unmount } = render(
        <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" page={page} />,
      );
      const canvas = container.querySelector("[data-preview-canvas]") as HTMLElement;
      expect(canvas.style.fontFamily).toBe(
        "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif",
      );
      unmount();
    }
  });
});
