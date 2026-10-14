import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeFacetValueVisual,
  normalizeFacetVisual,
  resolveFacetSelfVisual,
  resolveFacetValueVisual,
} from "../presentation/facet-visual";

/**
 * AWJ-VD-H1 / VD-1a — the admin twin runs the same shared fixtures as PHP and the storefront twin, and the two TS
 * files must stay byte-identical (the storefront suite also pins the closed lists against PHP).
 */
const repo = (path: string) => readFileSync(resolve(process.cwd(), "..", path), "utf8");

type Case = { name: string; input: unknown; expected: Record<string, unknown> };
type ResolveCase = {
  name: string;
  facet: unknown;
  value?: unknown;
  context: Record<string, unknown>;
  expected: { visual: Record<string, unknown>; sources: Record<string, unknown> };
};

const normalisation = JSON.parse(repo("tests/Fixtures/presentation/facet-visual.json")) as {
  value: Case[];
  facet: Case[];
};
const inheritance = JSON.parse(
  repo("tests/Fixtures/presentation/facet-visual-inheritance.json"),
) as { value: ResolveCase[]; self: ResolveCase[] };

describe("facet visual twins", () => {
  it("are byte-identical between web and storefront", () => {
    for (const file of ["facet-visual.ts", "icon-registry.ts"]) {
      expect(repo(`web/src/modules/store-experience-builder/presentation/${file}`)).toBe(
        repo(`storefront/src/lib/presentation/${file}`),
      );
    }
  });
});

describe("facet visual normaliser — admin twin (shared fixture)", () => {
  for (const testCase of normalisation.value) {
    it(`value: ${testCase.name}`, () => {
      const actual = normalizeFacetValueVisual(testCase.input);
      expect(actual).toEqual(testCase.expected);
      expect(Object.keys(actual)).toEqual(Object.keys(testCase.expected));
    });
  }

  for (const testCase of normalisation.facet) {
    it(`facet: ${testCase.name}`, () => {
      expect(normalizeFacetVisual(testCase.input)).toEqual(testCase.expected);
    });
  }
});

describe("facet visual inheritance — admin twin (shared fixture)", () => {
  for (const testCase of inheritance.value) {
    it(`value: ${testCase.name}`, () => {
      const actual = resolveFacetValueVisual(testCase.facet, testCase.value, testCase.context);
      expect(actual.visual).toEqual(testCase.expected.visual);
      expect(Object.keys(actual.visual)).toEqual(Object.keys(testCase.expected.visual));
      expect(actual.sources).toEqual(testCase.expected.sources);
    });
  }

  for (const testCase of inheritance.self) {
    it(`self: ${testCase.name}`, () => {
      const actual = resolveFacetSelfVisual(testCase.facet, testCase.context);
      expect(actual.visual).toEqual(testCase.expected.visual);
      expect(actual.sources).toEqual(testCase.expected.sources);
    });
  }
});
