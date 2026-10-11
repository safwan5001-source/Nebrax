import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const saveMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/modules/commerce-workspace/presentation-versions", () => ({
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG, applyFlowersGiftSections } from "../presentation";
import { BUILT_IN_THEMES, applyThemeAsNewDraft, builtInTheme } from "../themes";

const bloom = builtInTheme("awj-bloom");
const market = builtInTheme("awj-market");
if (!bloom || !market) throw new Error("missing theme");

const base = {
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: {
    ...DEFAULT_PRESENTATION_CONFIG.homepage,
    sections: [
      { id: "hero-1", type: "hero" as const, visible: true },
      { id: "cat-1", type: "categories" as const, visible: true },
    ],
  },
};

function created(revision = 1) {
  return { ok: true, data: { id: "v-new", storefrontId: "s1", revision, config: DEFAULT_PRESENTATION_CONFIG } };
}

describe("applyThemeAsNewDraft (V10b)", () => {
  beforeEach(() => {
    createMock.mockReset();
    saveMock.mockReset();
    deleteMock.mockReset();
  });

  it("creates a NEW draft, saves the themed copy of the base with the new draft's revision, and never touches any other version", async () => {
    createMock.mockResolvedValue(created(4));
    saveMock.mockResolvedValue({ ok: true, data: {} });
    const result = await applyThemeAsNewDraft({ storefrontId: "s1", base, theme: market, versionName: "Market" });

    expect(result).toEqual({ ok: true, versionId: "v-new" });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith("s1", "Market");
    const [store, id, config, revision] = saveMock.mock.calls[0];
    expect([store, id, revision]).toEqual(["s1", "v-new", 4]);
    expect(config).toMatchObject({ themePreset: "awj-market", primaryColor: "#0f766e", density: "compact" });
    // the merchant's own sections survive; only their design is the theme's
    expect(config.homepage.sections.map((s: { id: string }) => s.id)).toEqual(["hero-1", "cat-1"]);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("rolls the new draft back when the save fails, and reports it", async () => {
    createMock.mockResolvedValue(created());
    saveMock.mockResolvedValue({ ok: false, reason: "conflict" });
    deleteMock.mockResolvedValue(true);
    const result = await applyThemeAsNewDraft({ storefrontId: "s1", base, theme: market, versionName: "Market" });

    expect(result).toEqual({ ok: false, reason: "save_failed" });
    expect(deleteMock).toHaveBeenCalledWith("s1", "v-new");
  });

  it("writes nothing when the version cannot be created", async () => {
    createMock.mockResolvedValue({ ok: false, reason: "error" });
    const result = await applyThemeAsNewDraft({ storefrontId: "s1", base, theme: market, versionName: "Market" });
    expect(result).toEqual({ ok: false, reason: "create_failed" });
    expect(saveMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("a theme that lists a global asset writes nothing at all (clone-on-apply is gated)", async () => {
    const result = await applyThemeAsNewDraft({
      storefrontId: "s1",
      base,
      theme: { ...market, assets: [{ key: "stock" }] },
      versionName: "x",
    });
    expect(result).toEqual({ ok: false, reason: "assets_unsupported" });
    expect(createMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  describe("AWJ Bloom gift pack (FLOWERS-H15)", () => {
    const pack = (sections: readonly (typeof base.homepage.sections)[number][]) =>
      Promise.resolve(
        applyFlowersGiftSections(sections, {
          facetKeys: { occasion: "occasions-mine", recipient: null },
          deliveryScheduleConfigured: true,
          copy: { occasionTitle: "تسوّق حسب المناسبة", recipientTitle: "R", deliveryPromiseTitle: "D" },
        }),
      );

    it("adds only what the store can back", async () => {
      createMock.mockResolvedValue(created());
      saveMock.mockResolvedValue({ ok: true, data: {} });
      await applyThemeAsNewDraft({ storefrontId: "s1", base, theme: bloom, versionName: "Bloom", giftSections: pack });
      const saved = saveMock.mock.calls[0][2];
      expect(saved.themePreset).toBe("awj-bloom");
      expect(saved.homepage.sections.map((s: { type: string }) => s.type)).toEqual(["hero", "discovery", "deliveryPromise", "categories"]);
    });

    it("still applies the theme, without sections, when the data cannot be read", async () => {
      createMock.mockResolvedValue(created());
      saveMock.mockResolvedValue({ ok: true, data: {} });
      const result = await applyThemeAsNewDraft({
        storefrontId: "s1",
        base,
        theme: bloom,
        versionName: "Bloom",
        giftSections: () => Promise.reject(new Error("network")),
      });
      expect(result.ok).toBe(true);
      expect(saveMock.mock.calls[0][2].homepage.sections.map((s: { id: string }) => s.id)).toEqual(["hero-1", "cat-1"]);
    });

    it("the other themes never ask for the pack", async () => {
      createMock.mockResolvedValue(created());
      saveMock.mockResolvedValue({ ok: true, data: {} });
      const spy = vi.fn(pack);
      for (const theme of BUILT_IN_THEMES.filter((t) => t.pack === undefined)) {
        await applyThemeAsNewDraft({ storefrontId: "s1", base, theme, versionName: "x", giftSections: spy });
      }
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
