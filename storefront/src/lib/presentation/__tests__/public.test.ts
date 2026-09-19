import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../config";
import {
  publishedExtraNav,
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

  it("does not emit CSS vars when nothing is published", () => {
    expect(publishedThemeStyle(null)).toBeUndefined();
    expect(
      publishedThemeStyle(DEFAULT_PRESENTATION_CONFIG)?.["--store-primary"],
    ).toBe("#12372a");
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
