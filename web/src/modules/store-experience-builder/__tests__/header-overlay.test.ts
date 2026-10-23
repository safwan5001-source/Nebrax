import { describe, expect, it } from "vitest";
import { OVERLAY_SOLID_AT_PX, overlayIsSolid } from "../presentation/header-design";
import {
  overlayHeroCandidate,
  overlayMarker,
  resolveHeaderOverlay,
} from "../presentation/header-overlay";
import type { DesignContext } from "../presentation/section-design-resolve";

const MEDIA = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const picture = (extra: Record<string, unknown> = {}) => ({
  background: {
    kind: "media",
    media: { mediaId: MEDIA, decorative: true },
    ...extra,
  },
});
const hero = (design: unknown = picture(), id = "hero") => ({
  id,
  type: "hero",
  visible: true,
  design: design as never,
});
function ctx(
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  } | null,
): DesignContext {
  return {
    primaryColor: "#12372a",
    accentColor: null,
    dir: "ltr",
    mediaBounds: () => bounds,
  };
}
const ON = { mode: "overlay-hero" as const };
const dark = {
  min: [10, 20, 30] as [number, number, number],
  max: [60, 70, 80] as [number, number, number],
};

describe("overlayHeroCandidate (V7c-2)", () => {
  it("needs the FIRST visible section to be a hero", () => {
    expect(overlayHeroCandidate([])).toEqual({ ok: false, reason: "no-hero" });
    expect(
      overlayHeroCandidate([
        { id: "b", type: "banner", visible: true },
        hero(),
      ]),
    ).toEqual({ ok: false, reason: "no-hero" });
    // a hidden section does not count as first
    expect(
      overlayHeroCandidate([
        { id: "b", type: "banner", visible: false },
        hero(),
      ]),
    ).toMatchObject({ ok: true });
  });

  it("needs a picture background, and not a split layout", () => {
    expect(
      overlayHeroCandidate([{ id: "hero", type: "hero", visible: true }]),
    ).toEqual({
      ok: false,
      reason: "not-picture",
    });
    expect(
      overlayHeroCandidate([
        hero({ background: { kind: "solid", color: { hex: "#000000" } } }),
      ]),
    ).toEqual({ ok: false, reason: "not-picture" });
    expect(
      overlayHeroCandidate([hero({ ...picture(), layout: "split" })]),
    ).toEqual({
      ok: false,
      reason: "split-layout",
    });
    expect(
      overlayHeroCandidate([hero({ ...picture(), layout: "centered" })]),
    ).toMatchObject({ ok: true });
  });
});

describe("resolveHeaderOverlay (V7c-2)", () => {
  it("is null unless the document opted in", () => {
    expect(resolveHeaderOverlay(undefined, [hero()], ctx(dark))).toBeNull();
    expect(
      resolveHeaderOverlay({ mode: "solid" }, [hero()], ctx(dark)),
    ).toBeNull();
    expect(
      resolveHeaderOverlay({ layout: "centered" }, [hero()], ctx(dark)),
    ).toBeNull();
  });

  it("explains a structural fallback", () => {
    expect(resolveHeaderOverlay(ON, [], ctx(dark))).toEqual({
      reason: "no-hero",
    });
    expect(
      resolveHeaderOverlay(
        ON,
        [{ id: "hero", type: "hero", visible: true }],
        ctx(dark),
      ),
    ).toEqual({
      reason: "not-picture",
    });
  });

  it("falls back to solid when the picture has no proven bounds", () => {
    expect(resolveHeaderOverlay(ON, [hero()], ctx(null))).toEqual({
      reason: "unprovable",
    });
    expect(
      resolveHeaderOverlay(ON, [hero()], {
        primaryColor: "#12372a",
        accentColor: null,
        dir: "ltr",
      }),
    ).toEqual({ reason: "unprovable" });
  });

  it("a dark picture gets white text", () => {
    const r = resolveHeaderOverlay(ON, [hero()], ctx(dark));
    expect(r).toEqual({
      overlay: { sectionId: "hero", tone: "light", fg: "#ffffff" },
    });
  });

  it("a bright picture gets black text", () => {
    const r = resolveHeaderOverlay(
      ON,
      [hero()],
      ctx({ min: [200, 210, 220], max: [250, 250, 250] }),
    );
    expect(r).toMatchObject({ overlay: { tone: "dark", fg: "#000000" } });
  });

  it("the hero's own overlay is part of what is proven", () => {
    // a bright picture under a 70 % black overlay is dark enough for white text
    const r = resolveHeaderOverlay(
      ON,
      [hero(picture({ overlay: { color: { hex: "#000000" }, alpha: 70 } }))],
      ctx({ min: [180, 180, 180], max: [250, 250, 250] }),
    );
    expect(r).toMatchObject({ overlay: { tone: "light", fg: "#ffffff" } });
  });

  it("a mid-tone or full-range picture is not provable — solid, never rescued by a wash", () => {
    expect(
      resolveHeaderOverlay(
        ON,
        [hero()],
        ctx({ min: [100, 100, 100], max: [160, 160, 160] }),
      ),
    ).toEqual({ reason: "unprovable" });
    expect(
      resolveHeaderOverlay(
        ON,
        [hero()],
        ctx({ min: [0, 0, 0], max: [255, 255, 255] }),
      ),
    ).toEqual({ reason: "unprovable" });
  });

  it("every outcome it accepts really clears 4.5:1 over the whole bounds", () => {
    const lum = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    let accepted = 0;
    for (let lo = 0; lo <= 240; lo += 8) {
      for (let span = 0; span <= 200; span += 10) {
        const hi = Math.min(255, lo + span);
        const r = resolveHeaderOverlay(
          ON,
          [hero()],
          ctx({ min: [lo, lo, lo], max: [hi, hi, hi] }),
        );
        if (!r || !("overlay" in r)) continue;
        accepted++;
        const white = r.overlay.fg === "#ffffff";
        const worst = white ? 1.05 / (lum(hi) + 0.05) : (lum(lo) + 0.05) / 0.05;
        expect(worst).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(accepted).toBeGreaterThan(50);
  });

  it("the marker tokens enumerate the tone", () => {
    expect(
      overlayMarker({ sectionId: "hero", tone: "light", fg: "#ffffff" }),
    ).toBe("on l");
    expect(
      overlayMarker({ sectionId: "hero", tone: "dark", fg: "#000000" }),
    ).toBe("on d");
  });
});

describe("overlayIsSolid (V7c-2)", () => {
  it("is transparent at the top, solid past the threshold or while the shopper works inside", () => {
    expect(overlayIsSolid(0, false)).toBe(false);
    expect(overlayIsSolid(OVERLAY_SOLID_AT_PX, false)).toBe(false);
    expect(overlayIsSolid(OVERLAY_SOLID_AT_PX + 1, false)).toBe(true);
    expect(overlayIsSolid(0, true)).toBe(true);
    expect(overlayIsSolid(-80, false)).toBe(false);
  });
});

describe("resolveHeaderOverlay — forced tone (AWJ-HEADER-OVERLAY-TONE)", () => {
  const bright = { min: [200, 210, 220] as [number, number, number], max: [250, 250, 250] as [number, number, number] };

  it("a forced tone that the picture supports is used exactly (and marks the same tokens)", () => {
    const light = resolveHeaderOverlay({ ...ON, overlayTone: "light" }, [hero()], ctx(dark));
    expect(light).toEqual({ overlay: { sectionId: "hero", tone: "light", fg: "#ffffff" } });
    const darkText = resolveHeaderOverlay({ ...ON, overlayTone: "dark" }, [hero()], ctx(bright));
    expect(darkText).toEqual({ overlay: { sectionId: "hero", tone: "dark", fg: "#000000" } });
    expect(overlayMarker((light as { overlay: never }).overlay)).toBe("on l");
    expect(overlayMarker((darkText as { overlay: never }).overlay)).toBe("on d");
  });

  it("a tone the whole picture cannot support keeps the header solid — never an unreadable overlay", () => {
    expect(resolveHeaderOverlay({ ...ON, overlayTone: "dark" }, [hero()], ctx(dark))).toEqual({
      reason: "tone-unprovable",
    });
    expect(resolveHeaderOverlay({ ...ON, overlayTone: "light" }, [hero()], ctx(bright))).toEqual({
      reason: "tone-unprovable",
    });
  });

  it("the automatic choice is untouched when no tone is forced (a bright picture still gets black text)", () => {
    expect(resolveHeaderOverlay(ON, [hero()], ctx(bright))).toMatchObject({ overlay: { tone: "dark", fg: "#000000" } });
    expect(resolveHeaderOverlay(ON, [hero()], ctx({ min: [0, 0, 0], max: [255, 255, 255] }))).toEqual({
      reason: "unprovable",
    });
  });

  it("a forced tone never widens what is provable: a mid-tone / full-range picture stays solid for either tone", () => {
    const wide = ctx({ min: [0, 0, 0], max: [255, 255, 255] });
    expect(resolveHeaderOverlay({ ...ON, overlayTone: "light" }, [hero()], wide)).toEqual({ reason: "tone-unprovable" });
    expect(resolveHeaderOverlay({ ...ON, overlayTone: "dark" }, [hero()], wide)).toEqual({ reason: "tone-unprovable" });
  });

  it("structural reasons come first, whatever the tone", () => {
    expect(resolveHeaderOverlay({ ...ON, overlayTone: "light" }, [], ctx(dark))).toEqual({ reason: "no-hero" });
  });

  it("without the opt-in a tone does nothing", () => {
    expect(resolveHeaderOverlay({ overlayTone: "light" } as never, [hero()], ctx(dark))).toBeNull();
  });
});
