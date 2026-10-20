import { describe, expect, it } from "vitest";
import {
  backgroundType,
  effectiveSolidHex,
  isBackgroundDefault,
  resetBackground,
  setGradient,
  setMediaBackground,
  setSolidColor,
  switchBackgroundType,
  withFocal,
} from "../presentation/background-edit";
import {
  DEFAULT_PRESENTATION_CONFIG,
  DEFAULT_STORE_BACKGROUND_COLOR,
  type StorefrontPresentationConfig,
  normalizePresentationConfig,
} from "../presentation/config";
import { resolveStorefrontBackgroundStyle } from "../presentation/storefront-background-render";
import { STOREFRONT_BACKGROUND_DIRECTIONS, normalizeStorefrontBackground } from "../presentation/storefront-background";

const MEDIA = "0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b";
const MEDIA_2 = "7c1d3e4f-5a6b-4c8d-9e0f-1a2b3c4d5e6f";

const legacy = (hex = "#ffeedd"): StorefrontPresentationConfig => ({ ...DEFAULT_PRESENTATION_CONFIG, backgroundColor: hex });
const paint = (config: StorefrontPresentationConfig, dir: "ltr" | "rtl" = "ltr") =>
  resolveStorefrontBackgroundStyle(config, dir);

describe("P3-A-05 background edit rules", () => {
  it("a legacy document is solid and untouched until an explicit edit", () => {
    const config = legacy();
    expect(backgroundType(config)).toBe("solid");
    expect(effectiveSolidHex(config)).toBe("#ffeedd");
    // Choosing the type that is already active is not an edit: the same object comes back.
    expect(switchBackgroundType(config, "solid")).toBe(config);
    expect(isBackgroundDefault(legacy(DEFAULT_STORE_BACKGROUND_COLOR))).toBe(true);
    expect(isBackgroundDefault(config)).toBe(false);
  });

  it("`background` overrides `backgroundColor` — the reason a colour-only write loses", () => {
    const gradient = { ...switchBackgroundType(legacy("#ff0000"), "gradient") };
    const painted = paint(gradient);
    expect(painted.backgroundImage).toContain("linear-gradient");
    // The legacy colour is only the fallback layer beneath the gradient.
    expect(painted.backgroundColor).toBe("#ff0000");
    // Writing only the legacy field (what the old control did) leaves the gradient on screen.
    const colourOnly = { ...gradient, backgroundColor: "#00ff00" };
    expect(paint(colourOnly).backgroundImage).toContain("linear-gradient");
  });

  it("switching gradient → solid drops the object so the solid actually becomes the effective background", () => {
    const gradient = setGradient(switchBackgroundType(legacy("#ff0000"), "gradient"), {
      from: { hex: "#112233" },
      to: { hex: "#445566" },
    });
    const solid = switchBackgroundType(gradient, "solid");
    expect("background" in solid).toBe(false);
    // continuity: the solid starts from the gradient's first colour, not a preset
    expect(solid.backgroundColor).toBe("#112233");
    expect(paint(solid)).toEqual({ backgroundColor: "#112233" });
  });

  it("editing the colour after an advanced background was selected updates the effective paint", () => {
    const media = setMediaBackground(legacy("#ff0000"), { media: { mediaId: MEDIA } });
    expect(backgroundType(media)).toBe("media");
    const edited = setSolidColor(media, "#abcdef");
    expect("background" in edited).toBe(false);
    expect(paint(edited)).toEqual({ backgroundColor: "#abcdef" });
    // An unsafe value is never written.
    expect(setSolidColor(edited, "red; background: url(x)")).toBe(edited);
    expect(setSolidColor(edited, "#abc")).toBe(edited);
  });

  it("an authored solid object is edited as the legacy colour (same paint, one source of truth)", () => {
    const authored: StorefrontPresentationConfig = { ...legacy("#ff0000"), background: { kind: "solid", color: { hex: "#123456" } } };
    expect(effectiveSolidHex(authored)).toBe("#123456");
    const edited = setSolidColor(authored, "#654321");
    expect("background" in edited).toBe(false);
    expect(paint(edited)).toEqual({ backgroundColor: "#654321" });
  });

  it("gradient: two colours, every approved direction, mirrored by the page direction and never free CSS", () => {
    const base = switchBackgroundType(legacy("#f8f9fa"), "gradient");
    expect(base.background).toMatchObject({ kind: "gradient", from: { hex: "#f8f9fa" }, direction: "to-bottom" });
    // a new gradient is visibly a gradient (its two ends differ) but stays close to the page colour
    const ends = base.background?.kind === "gradient" ? [base.background.from, base.background.to] : [];
    expect(ends).toHaveLength(2);
    expect("hex" in ends[0] && "hex" in ends[1] && ends[0].hex !== ends[1].hex).toBe(true);
    expect(ends[1]).toEqual({ hex: "#dce2e1" }); // 12% of the way towards the brand colour (#12372a)

    for (const direction of STOREFRONT_BACKGROUND_DIRECTIONS) {
      const next = setGradient(base, { direction });
      expect(normalizeStorefrontBackground(next.background)).toEqual(next.background);
    }
    // logical directions flip with the writing direction; physical vertical ones do not
    const end = setGradient(base, { direction: "to-end" });
    expect(paint(end, "ltr").backgroundImage).not.toBe(paint(end, "rtl").backgroundImage);
    const down = setGradient(base, { direction: "to-bottom" });
    expect(paint(down, "ltr").backgroundImage).toBe(paint(down, "rtl").backgroundImage);

    // an unapproved direction cannot be authored: normalisation rejects the whole object
    expect(
      normalizeStorefrontBackground({ ...base.background, direction: "45deg); background: url(//evil" }),
    ).toBeNull();
    // setGradient is a no-op unless the document is a gradient
    expect(setGradient(legacy(), { direction: "to-end" })).toEqual(legacy());
  });

  it("image: desktop + phone image, focal point per image, overlay — decorative, ids only", () => {
    let config = setMediaBackground(legacy(), { media: { mediaId: MEDIA } });
    config = setMediaBackground(config, { mobile: { mediaId: MEDIA_2 } });
    config = setMediaBackground(config, { media: withFocal(config.background?.kind === "media" ? config.background.media : { mediaId: MEDIA }, { x: 100, y: 0 }) });
    config = setMediaBackground(config, { overlay: { color: { role: "overlay" }, alpha: 35 } });
    expect(config.background).toEqual({
      kind: "media",
      media: { mediaId: MEDIA, decorative: true, focal: { x: 100, y: 0 } },
      mobile: { mediaId: MEDIA_2, decorative: true },
      overlay: { color: { role: "overlay" }, alpha: 35 },
    });
    // the legacy colour stays as the fallback under the picture
    expect(config.backgroundColor).toBe("#ffeedd");
    // a media background paints only the fallback colour; the picture is a separate layer
    expect(paint(config)).toEqual({ backgroundColor: "#ffeedd" });
    // the contract's own normaliser accepts exactly this shape
    expect(normalizeStorefrontBackground(config.background)).toEqual(config.background);
  });

  it("a centred focal point is the default and is never stored", () => {
    const ref = withFocal({ mediaId: MEDIA }, { x: 20, y: 80 });
    expect(ref.focal).toEqual({ x: 20, y: 80 });
    expect("focal" in withFocal(ref, { x: 50, y: 50 })).toBe(false);
  });

  it("clearing the phone image keeps the main image; clearing the main image removes the whole object", () => {
    const both = setMediaBackground(setMediaBackground(legacy(), { media: { mediaId: MEDIA } }), {
      mobile: { mediaId: MEDIA_2 },
      overlay: { color: { hex: "#000000" }, alpha: 20 },
    });
    const noPhone = setMediaBackground(both, { mobile: null });
    expect(noPhone.background).toEqual({
      kind: "media",
      media: { mediaId: MEDIA, decorative: true },
      overlay: { color: { hex: "#000000" }, alpha: 20 },
    });
    const noOverlay = setMediaBackground(both, { overlay: null });
    expect(noOverlay.background && "overlay" in noOverlay.background).toBe(false);
    const none = setMediaBackground(both, { media: null });
    expect("background" in none).toBe(false);
    expect(none.backgroundColor).toBe("#ffeedd"); // falls back to the legacy colour
  });

  it("restore default returns the default colour and drops any advanced object (unlike switching type)", () => {
    const media = setMediaBackground(legacy("#ff0000"), { media: { mediaId: MEDIA } });
    const reset = resetBackground(media);
    expect("background" in reset).toBe(false);
    expect(reset.backgroundColor).toBe(DEFAULT_STORE_BACKGROUND_COLOR);
    expect(isBackgroundDefault(reset)).toBe(true);
    // switching type kept the previous colour; reset does not
    const switched = switchBackgroundType(switchBackgroundType(legacy("#ff0000"), "gradient"), "solid");
    expect(switched.backgroundColor).toBe("#ff0000");
    expect(resetBackground(switchBackgroundType(legacy("#ff0000"), "gradient"))).toEqual(resetBackground(legacy("#ff0000")));
  });

  it("what is saved holds no URL, CSS or resolved media, and survives a save → reload round trip", () => {
    const configs = [
      switchBackgroundType(legacy("#101010"), "gradient"),
      setMediaBackground(legacy(), { media: { mediaId: MEDIA }, mobile: { mediaId: MEDIA_2 }, overlay: { color: { role: "overlay" }, alpha: 40 } }),
      resetBackground(legacy()),
      setSolidColor(legacy(), "#aabbcc"),
    ];
    for (const config of configs) {
      const saved = normalizePresentationConfig(config);
      const reloaded = normalizePresentationConfig(JSON.parse(JSON.stringify(saved)));
      expect(reloaded.background).toEqual(saved.background);
      expect(reloaded.backgroundColor).toEqual(saved.backgroundColor);
      const text = JSON.stringify(saved);
      expect(text).not.toMatch(/https?:|url\(|linear-gradient|signed|previewUrl|thumbnailUrl/i);
    }
  });
});
