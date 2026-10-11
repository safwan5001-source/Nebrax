import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import { sanitizeContentHref, sliderContentOf } from "../section-content";
import type { DesignContext, MediaBounds } from "../section-design-resolve";
import {
  MAX_SLIDER_SLIDES,
  normalizeSliderContent,
  resolveSliderBehaviour,
  type SliderContent,
  slideContrastIssues,
  slideDraw,
  sliderPublishIssues,
} from "../slider-content";

interface Fixture {
  content: Array<{ name: string; input: unknown; expected: unknown }>;
  publish: Array<{
    name: string;
    config: {
      primaryColor: string;
      accentColor: string | null;
      palette: Record<string, string> | never[];
    };
    content: SliderContent;
    media: Record<string, MediaBounds | null>;
    expected: Array<{ path: string; code: string }>;
  }>;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/slider.json",
    ),
    "utf8",
  ),
) as Fixture;

describe("slider content — shared fixture (V8a)", () => {
  for (const c of fixture.content) {
    it(c.name, () => {
      const config = normalizePresentationConfig({
        version: 2,
        homepage: {
          sections: [
            { id: "sec-a", type: "slider", visible: true, content: c.input },
          ],
        },
      });
      const section = config.homepage.sections.find((s) => s.id === "sec-a");
      expect(section, "the slider section itself survives").toBeDefined();
      // key order is part of the contract: compare serialised
      expect(JSON.stringify(section?.content ?? null)).toBe(
        JSON.stringify(c.expected),
      );
      // idempotent
      const again = normalizeSliderContent(
        section?.content,
        sanitizeContentHref,
      );
      expect(JSON.stringify(again ?? null)).toBe(JSON.stringify(c.expected));
    });
  }
});

describe("slider publish rules — shared fixture (V8a)", () => {
  for (const c of fixture.publish) {
    it(c.name, () => {
      const palette = Array.isArray(c.config.palette)
        ? undefined
        : (c.config.palette as Record<string, string>);
      const ctx: DesignContext = {
        primaryColor: c.config.primaryColor,
        accentColor: c.config.accentColor,
        palette,
        dir: "ltr",
        mediaBounds: (ref) => c.media[ref.mediaId] ?? null,
      };
      expect(sliderPublishIssues(c.content, ctx)).toEqual(c.expected);
    });
  }

  it("no media evidence available at all ⇒ a slide with text is unprovable (fail-closed)", () => {
    const ctx: DesignContext = {
      primaryColor: "#12372a",
      accentColor: null,
      dir: "ltr",
    };
    const slide = (id: string, heading?: string) => ({
      id,
      media: { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e" },
      ...(heading ? { heading } : {}),
    });
    expect(
      sliderPublishIssues({ slides: [slide("a", "Hi"), slide("b")] }, ctx),
    ).toEqual([{ path: "slides[0].media", code: "contrast_unprovable" }]);
  });
});

describe("slideContrastIssues (V8c)", () => {
  const ctx: DesignContext = { primaryColor: "#12372a", accentColor: null, dir: "ltr" };
  const media = { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e" };

  it("judges one slide on its own, whatever the slide count — a slide without copy is never judged", () => {
    expect(slideContrastIssues({ id: "a", media }, ctx)).toEqual([]);
    expect(slideContrastIssues({ id: "a", media, heading: "Hi" }, ctx)).toEqual([
      expect.objectContaining({ field: "background", code: "contrast_unprovable" }),
    ]);
    // the count rule short-circuits `sliderPublishIssues` for one slide; the per-slide verdict does not
    expect(sliderPublishIssues({ slides: [{ id: "a", media, heading: "Hi" }] }, ctx)).toEqual([
      { path: "slides", code: "slider_slides_min" },
    ]);
  });
});

describe("slider helpers (V8a)", () => {
  it("resolveSliderBehaviour makes every default explicit", () => {
    expect(resolveSliderBehaviour(undefined)).toEqual({
      autoplay: false,
      interval: 6,
      transition: "slide",
      duration: "base",
      arrows: true,
      dots: true,
      loop: false,
    });
    expect(
      resolveSliderBehaviour({
        autoplay: true,
        interval: 10,
        transition: "fade",
        duration: "slow",
        arrows: false,
        dots: false,
        loop: true,
      }),
    ).toEqual({
      autoplay: true,
      interval: 10,
      transition: "fade",
      duration: "slow",
      arrows: false,
      dots: false,
      loop: true,
    });
  });

  it("sliderContentOf reads only a slider's own slides", () => {
    const content = {
      slides: [
        { id: "a", media: { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e" } },
      ],
    };
    expect(sliderContentOf({ type: "slider", content })).toBe(content);
    expect(sliderContentOf({ type: "banner", content })).toEqual({
      slides: [],
    });
    expect(sliderContentOf({ type: "slider" })).toEqual({ slides: [] });
  });

  it("the slide cap is eight (V0 §13.1)", () => {
    expect(MAX_SLIDER_SLIDES).toBe(8);
  });

  it("a document without any slider normalizes exactly as before (absent ⇒ unchanged)", () => {
    const config = normalizePresentationConfig({ version: 3 });
    expect(config.homepage.sections.some((s) => s.type === "slider")).toBe(
      false,
    );
    expect(config.version).toBe(3);
  });
});

describe("slideDraw — the one per-slide decision the storefront and the Canvas share (V8c)", () => {
  const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
  const ID2 = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
  const dark = { min: [10, 12, 14], max: [40, 50, 60] } as MediaBounds;
  const wide = { min: [0, 0, 0], max: [255, 255, 255] } as MediaBounds;
  const ctx = (bounds: Record<string, MediaBounds | null>): DesignContext => ({
    primaryColor: "#12372a",
    accentColor: null,
    dir: "ltr",
    mediaBounds: (ref) => bounds[ref.mediaId] ?? null,
  });
  const slide = (extra: Record<string, unknown> = {}) =>
    ({ id: "a", media: { mediaId: ID }, ...extra }) as never;

  it("a proven picture draws the picture with the proven colour and the solid button's label", () => {
    expect(slideDraw(slide({ heading: "Hi" }), ctx({ [ID]: dark }))).toEqual({
      surface: "picture",
      foreground: "#ffffff",
      buttonLabel: "#000000",
      overlay: null,
    });
  });

  it("unproven copy withholds the picture: the brand surface with its own foreground", () => {
    const d = slideDraw(
      slide({
        heading: "Hi",
        overlay: { color: { hex: "#000000" }, alpha: 10 },
      }),
      ctx({ [ID]: wide }),
    );
    expect(d.surface).toBe("brand");
    expect(d.overlay).toBeNull();
    expect(d.foreground).toBe("#ffffff");
    expect(slideDraw(slide({ heading: "Hi" }), ctx({})).surface).toBe("brand");
  });

  it("no copy: the picture shows whatever the evidence, and nothing is coloured", () => {
    expect(slideDraw(slide(), ctx({}))).toEqual({
      surface: "picture",
      foreground: null,
      buttonLabel: null,
      overlay: null,
    });
  });

  it("an overlay resolves its colour (hex or palette role) and strength, and makes a wide picture provable", () => {
    const d = slideDraw(
      slide({
        heading: "Hi",
        overlay: { color: { hex: "#000000" }, alpha: 70 },
      }),
      ctx({ [ID]: wide }),
    );
    expect(d).toMatchObject({
      surface: "picture",
      overlay: { colour: "#000000", alpha: 0.7 },
    });
    expect(
      slideDraw(
        slide({ overlay: { color: { role: "brand" }, alpha: 40 } }),
        ctx({ [ID]: dark }),
      ).overlay,
    ).toEqual({ colour: "#12372a", alpha: 0.4 });
  });

  it("an explicit colour that fails withholds the picture; one that passes is used", () => {
    expect(
      slideDraw(
        slide({ heading: "Hi", text: { hex: "#222222" } }),
        ctx({ [ID]: dark }),
      ).surface,
    ).toBe("brand");
    expect(
      slideDraw(
        slide({ heading: "Hi", text: { hex: "#fffbe6" } }),
        ctx({ [ID]: dark }),
      ),
    ).toMatchObject({
      surface: "picture",
      foreground: "#fffbe6",
    });
  });

  it("the phone picture is judged with the default one", () => {
    const withPhone = slide({
      heading: "Hi",
      mobile: { mediaId: ID2, decorative: true },
    });
    expect(slideDraw(withPhone, ctx({ [ID]: dark, [ID2]: dark })).surface).toBe(
      "picture",
    );
    expect(slideDraw(withPhone, ctx({ [ID]: dark, [ID2]: wide })).surface).toBe(
      "brand",
    );
    expect(slideDraw(withPhone, ctx({ [ID]: dark })).surface).toBe("brand");
  });
});
