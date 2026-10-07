import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSectionDesign } from "../section-design";
import {
  type DesignContext,
  effectiveText,
  sectionContrastIssues,
} from "../section-design-resolve";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/section-design-contrast.json",
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    name: string;
    config: {
      primaryColor: string;
      accentColor: string | null;
      palette: DesignContext["palette"];
    };
    design: Record<string, unknown>;
    expected: Array<{ field: string; code: string; ratio: number }>;
  }>;
};

describe("section design publish contrast — shared fixture with the PHP gate (V5d)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const design = normalizeSectionDesign("hero", c.design) ?? {};
      const ctx: DesignContext = {
        primaryColor: c.config.primaryColor,
        accentColor: c.config.accentColor,
        palette: c.config.palette,
        dir: "ltr",
      };
      const actual = sectionContrastIssues(design, ctx);
      expect(actual.map((i) => [i.field, i.code])).toEqual(
        c.expected.map((i) => [i.field, i.code]),
      );
      c.expected.forEach((e, i) => {
        expect(Math.abs(e.ratio - (actual[i]?.ratio ?? 0))).toBeLessThan(1e-4);
      });
    });
  }

  it("judges explicit text without a background against the page background", () => {
    const text = effectiveText(
      { text: { body: { hex: "#ffffff" } } },
      { primaryColor: "#12372a", accentColor: null, dir: "ltr" },
    );
    expect(text.background).toBeNull();
    expect(text.judged).not.toBeNull();
  });

  it("has nothing to judge for a design that sets no colour", () => {
    const text = effectiveText(
      { spacing: { top: "md" } },
      { primaryColor: "#12372a", accentColor: null, dir: "ltr" },
    );
    expect(text.judged).toBeNull();
  });
});
