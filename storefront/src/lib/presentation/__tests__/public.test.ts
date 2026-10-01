import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../config";
import {
  publishedExtraNav,
  publishedFaviconUrl,
  publishedStoreName,
  publishedThemeStyle,
  publishedWhatsAppHref,
  readPublishedPresentation,
} from "../public";

describe("published presentation runtime helpers", () => {
  it("treats missing published payload as null rather than AWJ Modern", () => {
    expect(readPublishedPresentation(null)).toBeNull();
    expect(readPublishedPresentation(undefined)).toBeNull();
    expect(readPublishedPresentation([])).toBeNull();
  });

  it("normalizes a published object fail-closed", () => {
    const published = readPublishedPresentation({
      themePreset: "navy",
      primaryColor: "red",
      homepage: { heroHeadline: "حي" },
    });
    expect(published?.themePreset).toBe("navy");
    expect(published?.primaryColor).toBe("#1e3a5f");
    expect(published?.homepage.heroHeadline).toBe("حي");
  });

  it("uses display name then live name", () => {
    expect(publishedStoreName(null, "حي", "المتجر")).toBe("حي");
    expect(
      publishedStoreName(
        {
          ...DEFAULT_PRESENTATION_CONFIG,
          branding: {
            ...DEFAULT_PRESENTATION_CONFIG.branding,
            displayName: "ظاهر",
          },
        },
        "حي",
        "المتجر",
      ),
    ).toBe("ظاهر");
  });

  it("prioritizes a safe favicon, then falls back to a safe logo", () => {
    expect(publishedFaviconUrl(null)).toBeNull();
    expect(
      publishedFaviconUrl({
        ...DEFAULT_PRESENTATION_CONFIG,
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          faviconDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        },
      }),
    ).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(
      publishedFaviconUrl({
        ...DEFAULT_PRESENTATION_CONFIG,
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          faviconDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      }),
    ).toBeNull();
    expect(
      publishedFaviconUrl({
        ...DEFAULT_PRESENTATION_CONFIG,
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          logoDataUrl: "https://cdn.example.test/store.webp",
        },
      }),
    ).toBe("https://cdn.example.test/store.webp");
    expect(
      publishedFaviconUrl({
        ...DEFAULT_PRESENTATION_CONFIG,
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          faviconDataUrl: "javascript:alert(1)",
          logoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      }),
    ).toBeNull();
  });

  it("does not emit CSS vars when nothing is published", () => {
    expect(publishedThemeStyle(null)).toBeUndefined();
    expect(
      publishedThemeStyle(DEFAULT_PRESENTATION_CONFIG)?.["--store-primary"],
    ).toBe("#12372a");
  });

  it("CUST-H3-2-FIX-1: sets fontFamily directly on the same style object as the color vars, so the wrapper that consumes it actually owns it", () => {
    // `(storefront)/layout.tsx` applies this entire object as one inline
    // `style` on its theme wrapper div. A CSS custom property (like
    // `--store-primary`) and a real CSS property (`fontFamily`) living on
    // that same object/element both resolve for that element and cascade
    // down normally — unlike a custom property declared on a descendant
    // that a `globals.css` rule on `body` (an ancestor) tries to consume,
    // which can never work (custom properties only cascade downward).
    const cairoStyle = publishedThemeStyle(DEFAULT_PRESENTATION_CONFIG);
    expect(cairoStyle?.["--store-primary"]).toBe("#12372a");
    expect(cairoStyle?.fontFamily).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );

    const tajawalStyle = publishedThemeStyle({
      ...DEFAULT_PRESENTATION_CONFIG,
      fontPreset: "tajawal-geist",
    });
    expect(tajawalStyle?.fontFamily).toBe(
      "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif",
    );
    // The published Tajawal stack must never reference Cairo or the shared
    // --font-geist (whose own fallback bakes in Cairo) — otherwise Cairo
    // would answer for Arabic glyphs before Tajawal is ever reached.
    expect(tajawalStyle?.fontFamily).not.toContain("--font-cairo");
    expect(tajawalStyle?.fontFamily).not.toMatch(/var\(--font-geist\),/);
  });

  it("no-presentation routes keep the Cairo + Geist default — never crash, never leak a stale stack", () => {
    expect(publishedThemeStyle(null)).toBeUndefined();
  });

  it("unmounts WhatsApp unless enabled with a sanitary number", () => {
    expect(
      publishedWhatsAppHref(DEFAULT_PRESENTATION_CONFIG, "floating"),
    ).toBeNull();
    expect(
      publishedWhatsAppHref(
        {
          ...DEFAULT_PRESENTATION_CONFIG,
          whatsapp: {
            enabled: true,
            phone: "12",
            message: "hi",
            placement: "floating",
          },
        },
        "floating",
      ),
    ).toBeNull();
    expect(
      publishedWhatsAppHref(
        {
          ...DEFAULT_PRESENTATION_CONFIG,
          whatsapp: {
            enabled: true,
            phone: "966551234567",
            message: "hi",
            placement: "floating",
          },
        },
        "floating",
      ),
    ).toBe("https://wa.me/966551234567?text=hi");
  });

  it("keeps only enabled extra nav with safe hrefs", () => {
    const links = publishedExtraNav(
      {
        ...DEFAULT_PRESENTATION_CONFIG,
        header: {
          ...DEFAULT_PRESENTATION_CONFIG.header,
          links: [
            {
              id: "nav-ext",
              label: "Instagram",
              kind: "external",
              href: "javascript:alert(1)",
              enabled: true,
            },
            {
              id: "nav-about",
              label: "About",
              kind: "content",
              href: "/about",
              enabled: true,
            },
          ],
        },
      },
      "/sa/en",
    );
    expect(links).toEqual([
      { id: "nav-about", label: "About", href: "/sa/en/about" },
    ]);
  });
});
