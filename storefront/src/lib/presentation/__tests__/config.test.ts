import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
  previewStoreName,
} from "../config";
import { HOME_BUILDER_SECTION_KEYS } from "../tokens";

describe("normalizePresentationConfig", () => {
  it("resolves missing config to AWJ Modern defaults", () => {
    expect(normalizePresentationConfig()).toEqual(DEFAULT_PRESENTATION_CONFIG);
    expect(normalizePresentationConfig(null)).toEqual(
      DEFAULT_PRESENTATION_CONFIG,
    );
    expect(normalizePresentationConfig({})).toMatchObject({
      themePreset: "awj-modern",
      primaryColor: "#12372a",
      version: 1,
    });
  });

  it("drops unknown homepage section keys and keeps implemented ones", () => {
    const normalized = normalizePresentationConfig({
      homepage: {
        sections: [
          { key: "banner-html", visible: true },
          { key: "hero", visible: false },
        ],
      },
    });

    expect(normalized.homepage.sections.some((s) => s.key === "hero")).toBe(
      true,
    );
    expect(
      normalized.homepage.sections.some((s) => String(s.key) === "banner-html"),
    ).toBe(false);
    expect(normalized.homepage.sections.map((s) => s.key).sort()).toEqual(
      [...HOME_BUILDER_SECTION_KEYS].sort(),
    );
  });

  it("rejects unsupported colours instead of applying them", () => {
    const normalized = normalizePresentationConfig({
      primaryColor: "red",
      accentColor: "#fff",
    });
    expect(normalized.primaryColor).toBe("#12372a");
    expect(normalized.accentColor).toBeNull();
  });

  it("never treats a merchant verification flag as authority", () => {
    const normalized = normalizePresentationConfig({
      verification: {
        crNumber: "1234567890",
        requestedVerifiedLabel: true,
        sourceUrl: "javascript:alert(1)",
      },
    });
    expect(normalized.verification.crNumber).toBe("1234567890");
    expect(normalized.verification.requestedVerifiedLabel).toBe(true);
    expect(normalized.verification.sourceUrl).toBe("");
  });

  it("sanitizes external navigation and social URLs", () => {
    const normalized = normalizePresentationConfig({
      header: {
        links: [
          {
            id: "x",
            label: "Bad",
            kind: "external",
            href: "javascript:alert(1)",
            enabled: true,
          },
          {
            id: "ok",
            label: "Instagram",
            kind: "external",
            href: "https://instagram.com/store",
            enabled: true,
          },
        ],
      },
      social: [
        {
          id: "ig",
          network: "instagram",
          url: "http://instagram.com/insecure",
          enabled: true,
        },
      ],
      apps: {
        iosUrl: "https://example.com/not-app-store",
        androidUrl: "https://play.google.com/store/apps/details?id=com.example",
      },
    });

    expect(normalized.header.links[0].href).toBe("");
    expect(normalized.header.links[1].href).toContain("https://instagram.com");
    expect(normalized.social[0].url).toBe("");
    expect(normalized.apps.iosUrl).toBe("");
    expect(normalized.apps.androidUrl).toContain("play.google.com");
  });

  it("does not invent a store name when branding is empty", () => {
    expect(previewStoreName(DEFAULT_PRESENTATION_CONFIG, null, "Shop")).toBe(
      "Shop",
    );
    expect(
      previewStoreName(DEFAULT_PRESENTATION_CONFIG, " Noon ", "Shop"),
    ).toBe("Noon");
  });
});
