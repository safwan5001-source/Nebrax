/**
 * CUST-HV V6a (V0 §8.1–8.2) — per-instance hero content. Twin of the same file in the other app and
 * of the PHP StorefrontPresentationHeroContentTest: all three read the SAME fixture
 * (tests/Fixtures/presentation/hero-content.json), so none can drift silently.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_HERO_INSTANCES,
  normalizePresentationConfig,
} from "../presentation/config";
import {
  heroContentOf,
  normalizeOptionalSectionContent,
  type SectionContent,
} from "../presentation/section-content";

interface Case {
  name: string;
  type: string;
  input: unknown;
  expected: unknown;
}

// Both apps run vitest from their own directory (one level below the repo root).
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "tests/Fixtures/presentation/hero-content.json"),
    "utf8",
  ),
) as { cases: Case[] };

describe("hero content (shared fixture)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const actual = normalizeOptionalSectionContent(testCase.type, testCase.input);
      if (testCase.expected === null) {
        expect(actual).toBeUndefined();
      } else {
        expect(actual).toEqual(testCase.expected);
        // canonical key order, not just structural equality
        expect(JSON.stringify(actual)).toBe(JSON.stringify(testCase.expected));
      }
    });
  }

  it("is idempotent", () => {
    for (const testCase of fixture.cases) {
      const once = normalizeOptionalSectionContent(testCase.type, testCase.input);
      if (once === undefined) continue;
      expect(normalizeOptionalSectionContent(testCase.type, once)).toEqual(once);
    }
  });

  it("only a hero accepts hero content; other types still drop it", () => {
    const content = { headline: "H", ctas: [{ label: "A", href: "/a" }] };
    expect(normalizeOptionalSectionContent("categories", content)).toBeUndefined();
    expect(normalizeOptionalSectionContent("wholesale", content)).toBeUndefined();
  });

  it("heroContentOf reads only a hero's own content and never mistakes another shape for it", () => {
    const own: SectionContent = { headline: "H" };
    expect(heroContentOf({ type: "hero", content: own })).toEqual(own);
    expect(heroContentOf({ type: "hero" })).toBeUndefined(); // legacy globals
    expect(heroContentOf({ type: "banner", content: own })).toBeUndefined();
    expect(
      heroContentOf({
        type: "hero",
        content: { title: "T", body: "B" } as SectionContent,
      }),
    ).toBeUndefined();
  });
});

describe("hero instances in a document (V0 §8.1)", () => {
  const heroes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `hero-${i + 1}`,
      type: "hero",
      visible: true,
      content: { headline: `H${i + 1}` },
    }));

  it(`keeps several heroes in order and caps them at ${MAX_HERO_INSTANCES}`, () => {
    const out = normalizePresentationConfig({
      version: 3,
      homepage: { sections: [...heroes(5), { id: "cats", type: "categories", visible: true }] },
    });
    const types = out.homepage.sections.map((s) => s.id);
    expect(types).toEqual(["hero-1", "hero-2", "hero-3", "cats"]);
    expect(out.homepage.sections[2]).toMatchObject({ content: { headline: "H3" } });
  });

  it("allows zero heroes (v2+: absence is deletion)", () => {
    const out = normalizePresentationConfig({
      version: 3,
      homepage: { sections: [{ id: "cats", type: "categories", visible: true }] },
    });
    expect(out.homepage.sections.some((s) => s.type === "hero")).toBe(false);
  });

  it("a hero without content stays without content (legacy globals), and the globals are untouched", () => {
    const out = normalizePresentationConfig({
      version: 3,
      homepage: {
        heroHeadline: "Legacy",
        heroSubheadline: "Line",
        sections: [{ id: "hero", type: "hero", visible: true }],
      },
    });
    expect(out.homepage.sections[0]).toEqual({ id: "hero", type: "hero", visible: true });
    expect(out.homepage.heroHeadline).toBe("Legacy");
    expect(out.homepage.heroSubheadline).toBe("Line");
  });
});
