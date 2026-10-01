/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

/**
 * CUST-H3-4 — the Canvas renders one header/footer for whichever `page` is
 * selected (Home/Product/Category only switch the body between them, see
 * `StorefrontPreviewCanvas.tsx`'s single `page === ... ? ... : ...` branch
 * below the shared `<header>`). This proves that invariant directly against
 * a populated, non-default config — displayName, compact logo, compact
 * header and primary color all resolve identically across all three pages —
 * instead of assuming parity from the component's shape alone.
 */
describe("Customizer Canvas — cross-page identity/appearance parity (CUST-H3-4)", () => {
  afterEach(() => {
    cleanup();
  });

  it("resolves identical displayName, compact logo, compact header and primary color across Home, Product and Category", () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      primaryColor: "#7a2e8f",
      branding: {
        displayName: "ديوان الهدايا",
        logoDataUrl: "https://cdn.example.test/logo.png",
        compactLogoDataUrl: "https://cdn.example.test/logo-compact.png",
        faviconDataUrl: null,
      },
      header: {
        ...DEFAULT_PRESENTATION_CONFIG.header,
        style: "compact" as const,
      },
    };

    const results = (["home", "product", "category"] as const).map((page) => {
      const { container, unmount } = render(
        <StorefrontPreviewCanvas config={config} locale="ar" viewport="desktop" page={page} />,
      );
      const canvas = container.querySelector("[data-preview-canvas]") as HTMLElement;
      const logo = container.querySelector(
        'img[alt="ديوان الهدايا"]',
      ) as HTMLImageElement | null;
      const result = {
        page,
        primaryVar: canvas.style.getPropertyValue("--store-primary"),
        logoSrc: logo?.getAttribute("src") ?? null,
      };
      unmount();
      return result;
    });

    for (const result of results) {
      expect(result.logoSrc).toBe("https://cdn.example.test/logo-compact.png");
      expect(result.primaryVar).toBe("#7a2e8f");
    }
    expect(results[0].primaryVar).toBe(results[1].primaryVar);
    expect(results[1].primaryVar).toBe(results[2].primaryVar);
  });
});
