import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FACET_VISUAL_CONTENTS,
  FACET_VISUAL_FITS,
  FACET_VISUAL_SHAPE_LABELS,
  FACET_VISUAL_SHAPES,
  FACET_VISUAL_SIZES,
  normalizeFacetValueVisual,
  normalizeFacetVisual,
  resolveFacetSelfVisual,
  resolveFacetValueVisual,
} from "../facet-visual";
import { ICON_KEYS } from "../icon-registry";

/**
 * AWJ-VD-H1 / VD-1a — the same fixtures drive PHP `CommerceFacetVisualNormalizer` / `CommerceFacetVisualResolver`
 * and both TS twins, so the three cannot drift silently.
 */
const repo = (path: string) =>
  readFileSync(resolve(process.cwd(), "..", path), "utf8");

type Case = { name: string; input: unknown; expected: Record<string, unknown> };
type ResolveCase = {
  name: string;
  facet: unknown;
  value?: unknown;
  context: Record<string, unknown>;
  expected: {
    visual: Record<string, unknown>;
    sources: Record<string, unknown>;
  };
};

const normalisation = JSON.parse(
  repo("tests/Fixtures/presentation/facet-visual.json"),
) as {
  value: Case[];
  facet: Case[];
};
const inheritance = JSON.parse(
  repo("tests/Fixtures/presentation/facet-visual-inheritance.json"),
) as { value: ResolveCase[]; self: ResolveCase[] };

describe("facet visual normaliser (shared fixture)", () => {
  for (const testCase of normalisation.value) {
    it(`value: ${testCase.name}`, () => {
      const actual = normalizeFacetValueVisual(testCase.input);
      expect(actual).toEqual(testCase.expected);
      expect(Object.keys(actual)).toEqual(Object.keys(testCase.expected));
      if (actual.image) {
        expect(Object.keys(actual.image)).toEqual(
          Object.keys(testCase.expected.image as object),
        );
      }
      expect(normalizeFacetValueVisual(actual)).toEqual(actual);
    });
  }

  for (const testCase of normalisation.facet) {
    it(`facet: ${testCase.name}`, () => {
      const actual = normalizeFacetVisual(testCase.input);
      expect(actual).toEqual(testCase.expected);
      expect(Object.keys(actual)).toEqual(Object.keys(testCase.expected));
      for (const part of ["self", "defaults"] as const) {
        if (actual[part]) {
          expect(Object.keys(actual[part] as object)).toEqual(
            Object.keys(testCase.expected[part] as object),
          );
        }
      }
      expect(normalizeFacetVisual(actual)).toEqual(actual);
    });
  }
});

describe("facet visual inheritance (shared fixture)", () => {
  for (const testCase of inheritance.value) {
    it(`value: ${testCase.name}`, () => {
      const actual = resolveFacetValueVisual(
        testCase.facet,
        testCase.value,
        testCase.context,
      );
      expect(actual.visual).toEqual(testCase.expected.visual);
      expect(Object.keys(actual.visual)).toEqual(
        Object.keys(testCase.expected.visual),
      );
      expect(actual.sources).toEqual(testCase.expected.sources);
    });
  }

  for (const testCase of inheritance.self) {
    it(`self: ${testCase.name}`, () => {
      const actual = resolveFacetSelfVisual(testCase.facet, testCase.context);
      expect(actual.visual).toEqual(testCase.expected.visual);
      expect(Object.keys(actual.visual)).toEqual(
        Object.keys(testCase.expected.visual),
      );
      expect(actual.sources).toEqual(testCase.expected.sources);
    });
  }
});

/** The closed lists live in PHP (authority) and here; parse the PHP source so they cannot drift. */
function phpList(source: string, constant: string): string[] {
  const match = source.match(
    new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\];`),
  );
  if (!match) throw new Error(`constant ${constant} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("closed lists match the PHP authority", () => {
  const registry = repo("app/Support/Commerce/FacetVisualRegistry.php");

  it("shapes, contents, sizes and fits", () => {
    expect([...FACET_VISUAL_SHAPES]).toEqual(phpList(registry, "SHAPES"));
    expect([...FACET_VISUAL_CONTENTS]).toEqual(phpList(registry, "CONTENTS"));
    expect([...FACET_VISUAL_SIZES]).toEqual(phpList(registry, "SIZES"));
    expect([...FACET_VISUAL_FITS]).toEqual(phpList(registry, "FITS"));
  });

  it("every shape has a label in both languages", () => {
    expect(Object.keys(FACET_VISUAL_SHAPE_LABELS)).toEqual([
      ...FACET_VISUAL_SHAPES,
    ]);
    for (const shape of FACET_VISUAL_SHAPES) {
      expect(FACET_VISUAL_SHAPE_LABELS[shape].ar.trim()).not.toBe("");
      expect(FACET_VISUAL_SHAPE_LABELS[shape].en.trim()).not.toBe("");
    }
  });

  it("icon keys equal PHP IconRegistry::KEYS, in order", () => {
    expect([...ICON_KEYS]).toEqual(
      phpList(repo("app/Support/Commerce/IconRegistry.php"), "KEYS"),
    );
  });
});
