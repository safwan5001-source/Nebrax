/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { fontFamilyStack } from "../presentation/font-catalogue";
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

  it("every catalogue family — incl. the three Thmanyah — is a valid global font in the Canvas, on every page and viewport, in both locales", () => {
    for (const key of ["almarai", "thmanyah-sans", "thmanyah-serif-display", "thmanyah-serif-text"] as const) {
      for (const page of ["home", "product", "category"] as const) {
        for (const viewport of ["desktop", "mobile"] as const) {
          for (const locale of ["ar", "en"] as const) {
            const config = { ...DEFAULT_PRESENTATION_CONFIG, fontPreset: key };
            const { container, unmount } = render(
              <StorefrontPreviewCanvas config={config} locale={locale} viewport={viewport} page={page} />,
            );
            const canvas = container.querySelector("[data-preview-canvas]") as HTMLElement;
            expect(canvas.style.fontFamily).toBe(fontFamilyStack(key));
            unmount();
          }
        }
      }
    }
  });

  it("an explicit body family still beats the global font in the Canvas", () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      fontPreset: "thmanyah-sans" as const,
      typography: { bodyFamily: "readex" as const },
    };
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" />,
    );
    const canvas = container.querySelector("[data-preview-canvas]") as HTMLElement;
    expect(canvas.style.fontFamily).toBe(fontFamilyStack("readex"));
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
