import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../presentation/config";
import { sanitizeContentHref, sliderContentOf } from "../presentation/section-content";
import type { DesignContext, MediaBounds } from "../presentation/section-design-resolve";
import {
  MAX_SLIDER_SLIDES,
  normalizeSliderContent,
  resolveSliderBehaviour,
  type SliderContent,
  sliderPublishIssues,
} from "../presentation/slider-content";

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
