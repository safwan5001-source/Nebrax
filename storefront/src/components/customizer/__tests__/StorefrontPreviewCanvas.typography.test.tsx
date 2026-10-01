/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

/**
 * CUST-H3-2 — storefront trust-visual mirror of the Canvas Typography
 * runtime check. This mirror runs inside `DocumentShell` (dev layout), which
 * declares `--font-cairo`/`--font-tajawal` (and the two Geist instances,
 * `--font-geist`/`--font-geist-tajawal`) on every document, so it resolves
 * the preset directly without its own font-loading module (unlike the
 * standalone web Customizer app).
 */
describe("Storefront customizer mirror — Typography runtime (CUST-H3-2)", () => {
  afterEach(() => {
    cleanup();
  });

  it("cairo-geist resolves to the Geist/Cairo stack (unchanged default behavior)", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
      />,
    );
    const canvas = container.querySelector(
      "[data-preview-canvas]",
    ) as HTMLElement;
    expect(canvas.style.fontFamily).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );
  });

  it("tajawal-geist immediately resolves to the Geist/Tajawal stack", () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      fontPreset: "tajawal-geist" as const,
    };
    const { container } = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
      />,
    );
    const canvas = container.querySelector(
      "[data-preview-canvas]",
    ) as HTMLElement;
    // CUST-H3-2-FIX-1: must use the dedicated Tajawal-fallback Geist
    // instance (`--font-geist-tajawal`), never the shared `--font-geist` —
    // that instance's own fallback names Cairo and would shadow Tajawal.
    expect(canvas.style.fontFamily).toBe(
      "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif",
    );
    expect(canvas.style.fontFamily).not.toContain("--font-cairo");
  });

  it("an unknown/stale fontPreset fails closed to the Cairo stack", () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      fontPreset: "helvetica-geist" as never,
    };
    const { container } = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
      />,
    );
    const canvas = container.querySelector(
      "[data-preview-canvas]",
    ) as HTMLElement;
    expect(canvas.style.fontFamily).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );
  });
});
