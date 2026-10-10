import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ctaColourIssues,
  ctaPaint,
  effectiveCtaStyle,
  heroGradientInterval,
} from "../cta-colour";
import type { HeroCta } from "../section-content";
import { normalizeSectionDesign } from "../section-design";
import type { DesignContext } from "../section-design-resolve";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/cta-colour.json",
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    name: string;
    type: string;
    config: {
      primaryColor: string;
      accentColor: string | null;
      palette: DesignContext["palette"];
    };
    ctas: HeroCta[];
    design?: Record<string, unknown>;
    media?: Record<
      string,
      { min: [number, number, number]; max: [number, number, number] } | null
    >;
    expected: Array<{ index: number; code: string; ratio: number }>;
  }>;
};

describe("per-CTA colour publish contrast — shared fixture with the PHP gate (V6c-6)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const design = c.design
        ? (normalizeSectionDesign(c.type, c.design) ?? undefined)
        : undefined;
      const ctx: DesignContext = {
        primaryColor: c.config.primaryColor,
        accentColor: c.config.accentColor,
        palette: c.config.palette,
        dir: "ltr",
        mediaBounds: (ref) => c.media?.[ref.mediaId] ?? null,
      };
      const actual = ctaColourIssues(c.type, c.ctas, design, ctx);
      expect(actual.map((i) => [i.index, i.code])).toEqual(
        c.expected.map((i) => [i.index, i.code]),
      );
      c.expected.forEach((e, i) => {
        expect(Math.abs(e.ratio - (actual[i]?.ratio ?? 0))).toBeLessThan(1e-4);
      });
    });
  }
});

describe("cta colour helpers (V6c-6)", () => {
  const ctx: DesignContext = {
    primaryColor: "#12372a",
    accentColor: "#ffd166",
    dir: "ltr",
  };

  it("absent style is by position: first solid, second outline", () => {
    expect(effectiveCtaStyle(undefined, 0)).toBe("solid");
    expect(effectiveCtaStyle(undefined, 1)).toBe("outline");
    expect(effectiveCtaStyle("link", 0)).toBe("link");
  });

  it("solid and soft compute their label over their own fill (4.5:1 by construction); outline and link use the role colour", () => {
    const solid = ctaPaint("solid", "brand", ctx);
    expect(solid.fill).toBe("#12372a");
    expect(["#ffffff", "#000000"]).toContain(solid.label);
    const soft = ctaPaint("soft", "accent", ctx);
    expect(soft.fill).not.toBe("#ffd166"); // a light tint of the role, opaque
    const outline = ctaPaint("outline", "accent", ctx);
    expect(outline).toEqual({
      fill: "transparent",
      label: "#ffd166",
      border: "#ffd166",
    });
    const link = ctaPaint("link", "text", ctx);
    expect(link.fill).toBe("transparent");
    expect(link.border).toBe("transparent");
  });

  it("the hero's default backdrop is the brand gradient interval; an unparsable brand is unproven", () => {
    const interval = heroGradientInterval("#12372a");
    expect(interval).not.toBeNull();
    expect(interval?.min).toBeLessThan(interval?.max ?? 0);
    expect(heroGradientInterval("not-a-colour")).toBeNull();
  });
});
