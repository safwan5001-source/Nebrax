import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type StorefrontPresentationConfig,
  THEME_PRESETS,
  isSafeHexColor,
  normalizePresentationConfig,
} from "../presentation";
import { buttonContrastIssues } from "../presentation/global-tokens";
import { BUILT_IN_THEMES, THEME_AREAS, applyTheme, builtInTheme } from "../themes";

function configWithContent(): StorefrontPresentationConfig {
  return normalizePresentationConfig({
    ...DEFAULT_PRESENTATION_CONFIG,
    branding: { displayName: "متجري", logoDataUrl: null, compactLogoDataUrl: null, faviconDataUrl: null },
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      heroHeadline: "أهلاً",
      sections: [
        { id: "hero", type: "hero", visible: true, content: { headline: "هدايا", ctas: [] }, design: { align: "center" } },
        { id: "newArrivals", type: "newArrivals", visible: false, design: { layout: "rail" } },
        { id: "featured-1", type: "featured", visible: true, content: { productIds: ["p1"] }, design: { radius: "lg" } },
        { id: "benefits", type: "benefits", visible: true, content: { items: [{ id: "b1", title: "شحن", text: "سريع" }] } },
      ],
    },
    typography: { headingScale: "xl-not-valid" },
    surfaces: { radius: "pill" },
  });
}

describe("built-in themes (V10a)", () => {
  it("six themes, unique ids, bilingual, on an allow-listed preset with a safe primary", () => {
    expect(BUILT_IN_THEMES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(BUILT_IN_THEMES.map((t) => t.id)).size).toBe(BUILT_IN_THEMES.length);
    const presets = new Set<string>(THEME_PRESETS.map((p) => p.id));
    for (const theme of BUILT_IN_THEMES) {
      expect(presets.has(theme.themePreset), theme.id).toBe(true);
      expect(isSafeHexColor(theme.primaryColor), theme.id).toBe(true);
      expect(theme.name.ar && theme.name.en && theme.description.ar && theme.description.en, theme.id).toBeTruthy();
      expect(builtInTheme(theme.id)).toBe(theme);
    }
  });

  it("carries no media, no asset and no commercial key (V0 §14.3, AMEND-6)", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.assets ?? [], theme.id).toEqual([]);
      const text = JSON.stringify(theme);
      expect(text, theme.id).not.toMatch(/mediaId|dataUrl|https?:/i);
      expect(text, theme.id).not.toMatch(/price|discount|stock|availab|tax|vat|currency|sku|quantity/i);
    }
  });

  for (const theme of BUILT_IN_THEMES) {
    describe(theme.id, () => {
      const applied = applyTheme(configWithContent(), theme);

      it("applies, and loses nothing to normalisation", () => {
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        const c = applied.config;
        expect(c.themePreset).toBe(theme.themePreset);
        expect(c.primaryColor).toBe(theme.primaryColor);
        expect(c.typography).toEqual(theme.typography);
        expect(c.buttons).toEqual(theme.buttons);
        expect(c.surfaces).toEqual(theme.surfaces);
        expect(c.cards).toEqual(theme.cards);
        expect(c.layout).toEqual(theme.layout);
        expect(c.motion).toEqual(theme.motion);
        expect(c.header.design).toEqual(theme.header?.design);
        expect(c.footer.layout).toEqual(theme.footer?.layout);
      });

      it("passes the button-contrast gate", () => {
        if (!applied.ok) throw new Error("not applied");
        const c = applied.config;
        expect(buttonContrastIssues({ buttons: c.buttons }, { primaryColor: c.primaryColor, accentColor: c.accentColor, palette: c.palette })).toEqual([]);
      });

      it("an outline button on its primary would also pass (the gate is wired to the real colours)", () => {
        if (!applied.ok) throw new Error("not applied");
        const c = applied.config;
        expect(
          buttonContrastIssues({ buttons: { style: "outline", colour: "brand" } }, { primaryColor: c.primaryColor, accentColor: c.accentColor, palette: c.palette }),
        ).toEqual([]);
      });

      it("is idempotent: applying it again changes nothing", () => {
        if (!applied.ok) throw new Error("not applied");
        const again = applyTheme(applied.config, theme);
        expect(again.ok && again.summary.noop).toBe(true);
        expect(again.ok && JSON.stringify(again.config)).toBe(JSON.stringify(applied.config));
      });

      it("keeps every piece of content, order and visibility", () => {
        if (!applied.ok) throw new Error("not applied");
        const before = configWithContent();
        const strip = (config: StorefrontPresentationConfig) =>
          config.homepage.sections.map(({ design: _design, ...rest }) => rest);
        expect(strip(applied.config)).toEqual(strip(before));
        expect(applied.config.branding).toEqual(before.branding);
        expect(applied.config.homepage.heroHeadline).toBe(before.homepage.heroHeadline);
        expect(applied.config.navigation).toEqual(before.navigation);
        expect(applied.config.announcements).toEqual(before.announcements);
        expect(applied.config.footer.tagline).toBe(before.footer.tagline);
      });
    });
  }
});

describe("applyTheme summary (V10a)", () => {
  it("lists every area, in order, and what is kept", () => {
    const result = applyTheme(configWithContent(), BUILT_IN_THEMES[1]);
    if (!result.ok) throw new Error("not applied");
    expect(result.summary.areas.map((a) => a.area)).toEqual([...THEME_AREAS]);
    expect(result.summary.kept).toContain("content");
    expect(result.summary.kept).toContain("media");
    expect(result.summary.kept).toContain("order");
    expect(result.summary.noop).toBe(false);
  });

  it("reports the sections whose design changes (and only those)", () => {
    const market = BUILT_IN_THEMES.find((t) => t.id === "awj-market");
    if (!market) throw new Error("missing");
    const result = applyTheme(configWithContent(), market);
    if (!result.ok) throw new Error("not applied");
    const sections = result.summary.areas.find((a) => a.area === "sections");
    // hero (align:center → none) and featured-1 (radius → rail) and newArrivals (rail → rail, unchanged) …
    expect(sections?.sectionIds).toEqual(["hero", "featured-1"]);
    const featured = result.config.homepage.sections.find((s) => s.id === "featured-1");
    expect(featured?.design).toEqual({ layout: "rail" });
    const hero = result.config.homepage.sections.find((s) => s.id === "hero");
    expect(hero?.design).toBeUndefined();
  });

  it("a section design is limited to what the section type may use", () => {
    const trade = BUILT_IN_THEMES.find((t) => t.id === "awj-trade");
    if (!trade) throw new Error("missing");
    const result = applyTheme(configWithContent(), trade);
    if (!result.ok) throw new Error("not applied");
    expect(result.config.homepage.sections.find((s) => s.id === "featured-1")?.design).toEqual({ columns: 4 });
    expect(result.config.homepage.sections.find((s) => s.id === "benefits")?.design).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const input = configWithContent();
    const snapshot = JSON.stringify(input);
    applyTheme(input, BUILT_IN_THEMES[2]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("the contrast gate can fail (control)", () => {
  it("a pale primary fails an outline button", () => {
    expect(
      buttonContrastIssues({ buttons: { style: "outline", colour: "brand" } }, { primaryColor: "#f5f5f5", accentColor: null }).length,
    ).toBeGreaterThan(0);
  });
});

describe("theme assets are GATED (V0 §7.9, AMEND-6)", () => {
  it("a theme that lists a global asset cannot be applied until clone-on-apply exists", () => {
    const withAsset = { ...BUILT_IN_THEMES[0], assets: [{ key: "stock-hero" }] };
    const input = configWithContent();
    const snapshot = JSON.stringify(input);
    expect(applyTheme(input, withAsset)).toEqual({ ok: false, reason: "assets_unsupported" });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("no applied document, from any built-in theme, holds a media reference it did not already own", () => {
    const base = configWithContent();
    const owned = JSON.stringify(base).match(/"mediaId":"[^"]+"/g) ?? [];
    for (const theme of BUILT_IN_THEMES) {
      const result = applyTheme(base, theme);
      if (!result.ok) throw new Error("not applied");
      expect(JSON.stringify(result.config).match(/"mediaId":"[^"]+"/g) ?? []).toEqual(owned);
    }
  });
});
