import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  MAX_HOME_SECTIONS,
  normalizePresentationConfig,
  previewStoreName,
} from "../config";
import {
  FONT_PRESETS,
  HOME_BUILDER_SECTION_KEYS,
  PRESENTATION_CONFIG_VERSION,
} from "../tokens";

describe("normalizePresentationConfig", () => {
  it("resolves missing config to AWJ Modern defaults", () => {
    expect(normalizePresentationConfig()).toEqual(DEFAULT_PRESENTATION_CONFIG);
    expect(normalizePresentationConfig(null)).toEqual(
      DEFAULT_PRESENTATION_CONFIG,
    );
    expect(normalizePresentationConfig({})).toMatchObject({
      themePreset: "awj-modern",
      primaryColor: "#12372a",
      version: PRESENTATION_CONFIG_VERSION,
    });
  });

  it("accepts awj-market and derives its own default primary color", () => {
    expect(
      normalizePresentationConfig({ themePreset: "awj-market" }),
    ).toMatchObject({
      themePreset: "awj-market",
      primaryColor: "#0f766e",
    });
  });

  it("FLOWERS-H15: accepts awj-bloom with its own default primary, and a merchant color survives", () => {
    expect(
      normalizePresentationConfig({ themePreset: "awj-bloom" }),
    ).toMatchObject({ themePreset: "awj-bloom", primaryColor: "#9d2449" });
    expect(
      normalizePresentationConfig({
        themePreset: "awj-bloom",
        primaryColor: "#123456",
      }),
    ).toMatchObject({ themePreset: "awj-bloom", primaryColor: "#123456" });
  });

  it("a merchant-chosen color survives on awj-market like any other preset", () => {
    expect(
      normalizePresentationConfig({
        themePreset: "awj-market",
        primaryColor: "#123456",
      }),
    ).toMatchObject({ themePreset: "awj-market", primaryColor: "#123456" });
  });

  it("an unrecognized preset (including a stale awj-market variant) still fails closed to AWJ Modern", () => {
    expect(
      normalizePresentationConfig({ themePreset: "awj-market-v0" }),
    ).toMatchObject({ themePreset: "awj-modern", primaryColor: "#12372a" });
  });

  it("legacy key-shaped sections: drops unknown keys and migrates ids deterministically", () => {
    const normalized = normalizePresentationConfig({
      homepage: {
        sections: [
          { key: "banner-html", visible: true },
          { key: "hero", visible: false },
        ],
      },
    });

    const hero = normalized.homepage.sections.find((s) => s.type === "hero");
    expect(hero).toMatchObject({ id: "hero", visible: false });
    expect(
      normalized.homepage.sections.some(
        (s) => String(s.type) === "banner-html",
      ),
    ).toBe(false);
    // legacy semantics: missing defaults are re-appended
    expect(normalized.homepage.sections.map((s) => s.type).sort()).toEqual(
      [...HOME_BUILDER_SECTION_KEYS].sort(),
    );
    // legacy migration assigns id = key
    expect(normalized.homepage.sections.every((s) => s.id === s.type)).toBe(
      true,
    );
  });

  it("legacy normalization is idempotent and stable across repeated passes", () => {
    const legacyInput = {
      homepage: {
        sections: [
          { key: "hero", visible: true },
          { key: "categories", visible: false },
        ],
      },
    };
    const once = normalizePresentationConfig(legacyInput);
    const twice = normalizePresentationConfig(JSON.parse(JSON.stringify(once)));
    expect(twice.homepage.sections).toEqual(once.homepage.sections);
    expect(once.homepage.sections.map((s) => s.id)).toEqual([
      "hero",
      "categories",
      ...HOME_BUILDER_SECTION_KEYS.filter(
        (key) => key !== "hero" && key !== "categories",
      ),
    ]);
  });

  it("v2: keeps multiple instances of the same type with distinct ids", () => {
    const normalized = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [
          { id: "banner-a", type: "banner", visible: true },
          { id: "hero", type: "hero", visible: true },
          { id: "banner-b", type: "banner", visible: false },
        ],
      },
    });

    expect(
      normalized.homepage.sections.map((s) => [s.id, s.type, s.visible]),
    ).toEqual([
      ["banner-a", "banner", true],
      ["hero", "hero", true],
      ["banner-b", "banner", false],
    ]);
  });

  it("v2: absence of a section means deleted — no defaults resurrection", () => {
    const normalized = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [{ id: "hero", type: "hero", visible: true }],
      },
    });

    expect(normalized.homepage.sections.map((s) => s.type)).toEqual(["hero"]);
  });

  it("v2: an empty sections array stays empty", () => {
    const normalized = normalizePresentationConfig({
      version: 2,
      homepage: { sections: [] },
    });
    expect(normalized.homepage.sections).toEqual([]);
  });

  it("v2: drops unknown types fail-closed and duplicate ids deterministically (first wins)", () => {
    const normalized = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [
          { id: "x-1", type: "evil-type", visible: true },
          { id: "hero", type: "hero", visible: false },
          { id: "hero", type: "hero", visible: true },
          { id: "banner-1", type: "banner", visible: true },
        ],
      },
    });

    expect(normalized.homepage.sections).toEqual([
      { id: "hero", type: "hero", visible: false },
      { id: "banner-1", type: "banner", visible: true },
    ]);
  });

  it("v2: rejects unsafe ids and caps the section list", () => {
    const sections = Array.from({ length: MAX_HOME_SECTIONS + 5 }, (_, i) => ({
      id: `banner-${i}`,
      type: "banner",
      visible: true,
    }));
    sections.unshift({
      id: "bad id!!",
      type: "banner",
      visible: true,
    } as never);

    const normalized = normalizePresentationConfig({
      version: 2,
      homepage: { sections },
    });

    expect(normalized.homepage.sections).toHaveLength(MAX_HOME_SECTIONS);
    expect(
      normalized.homepage.sections.every((s) =>
        /^[a-zA-Z0-9_-]{1,64}$/.test(s.id),
      ),
    ).toBe(true);
  });

  it("v2 round-trip: re-normalizing normalized output is stable", () => {
    const input = {
      version: 2,
      homepage: {
        sections: [
          { id: "b1", type: "banner", visible: true },
          { id: "hero", type: "hero", visible: true },
          { id: "b2", type: "banner", visible: false },
        ],
      },
    };
    const once = normalizePresentationConfig(input);
    const twice = normalizePresentationConfig(JSON.parse(JSON.stringify(once)));
    expect(twice.homepage.sections).toEqual(once.homepage.sections);
  });

  it("CUST-H3-2: accepts the verified tajawal-geist preset and fails closed to cairo-geist for unknown values", () => {
    expect(
      normalizePresentationConfig({ fontPreset: "tajawal-geist" }).fontPreset,
    ).toBe("tajawal-geist");
    expect(
      normalizePresentationConfig({ fontPreset: "cairo-geist" }).fontPreset,
    ).toBe("cairo-geist");
    expect(
      normalizePresentationConfig({ fontPreset: "helvetica-geist" }).fontPreset,
    ).toBe("cairo-geist");
    expect(normalizePresentationConfig({}).fontPreset).toBe("cairo-geist");
    expect(FONT_PRESETS.map((preset) => preset.id)).toEqual([
      "cairo-geist",
      "tajawal-geist",
    ]);
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
    expect(normalized.verification.requestedVerifiedLabel).toBe(false);
    expect(normalized.verification.sourceUrl).toBe("");
  });

  it("keeps structured section content and drops offer or price authority", () => {
    const normalized = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [
          {
            id: "banner-a",
            type: "banner",
            visible: true,
            content: {
              title: "عرض",
              ctaHref: "javascript:alert(1)",
              imageUrl: "https://cdn.example.com/banner.jpg",
              html: "<script>",
            },
          },
          {
            id: "offers-a",
            type: "offers",
            visible: true,
            content: { discountPercent: 50 },
          },
          {
            id: "feat-a",
            type: "featured",
            visible: true,
            content: { productIds: ["prod-1", "prod-1", "bad id"], price: 10 },
          },
          { id: "banner-empty", type: "banner", visible: true },
        ],
      },
    });
    const banner = normalized.homepage.sections.find(
      (section) => section.id === "banner-a",
    );
    expect(banner?.content).toMatchObject({
      title: "عرض",
      ctaHref: "",
      imageUrl: "https://cdn.example.com/banner.jpg",
    });
    expect(banner?.content && "html" in banner.content).toBe(false);
    const offers = normalized.homepage.sections.find(
      (section) => section.id === "offers-a",
    );
    expect(offers?.content).toBeUndefined();
    const featured = normalized.homepage.sections.find(
      (section) => section.id === "feat-a",
    );
    expect(featured?.content).toEqual({ productIds: ["prod-1"] });
    const empty = normalized.homepage.sections.find(
      (section) => section.id === "banner-empty",
    );
    expect(empty?.content).toBeUndefined();
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
    expect(
      normalizePresentationConfig({
        apps: { iosUrl: "https://www.apple.com/iphone" },
      }).apps.iosUrl,
    ).toBe("");
    expect(
      normalizePresentationConfig({
        apps: { iosUrl: "https://apps.apple.com/app/id1" },
      }).apps.iosUrl,
    ).toContain("apps.apple.com");
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
