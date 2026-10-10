/**
 * CUST-HV V6c-2 (V0 §8.2) — Banner `ctas` (≤2) next to the legacy ctaLabel/ctaHref. Twin of the same file in the
 * other app and of the PHP StorefrontPresentationBannerWindowTest: all three read the SAME fixture
 * (tests/Fixtures/presentation/banner-ctas.json), so none can drift silently.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOptionalSectionContent } from "../presentation/section-content";

interface Case {
  name: string;
  type: string;
  input: unknown;
  expected: unknown;
}

// Both apps run vitest from their own directory (one level below the repo root).
const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "..",
      "tests/Fixtures/presentation/banner-ctas.json",
    ),
    "utf8",
  ),
) as { cases: Case[] };

describe("banner ctas (shared fixture)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const actual = normalizeOptionalSectionContent(
        testCase.type,
        testCase.input,
      );
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
      const once = normalizeOptionalSectionContent(
        testCase.type,
        testCase.input,
      );
      if (once === undefined) continue;
      expect(normalizeOptionalSectionContent(testCase.type, once)).toEqual(
        once,
      );
    }
  });

  it("only a banner and a hero accept ctas; other types drop them", () => {
    const content = { ctas: [{ label: "x", href: "/x" }] };
    expect(
      normalizeOptionalSectionContent("categories", content),
    ).toBeUndefined();
  });

  it("the hero keeps its exact CTA behaviour after sharing the list normaliser", () => {
    expect(
      normalizeOptionalSectionContent("hero", {
        headline: "H",
        ctas: [
          { label: "A", href: "/a" },
          { label: "", href: "" },
          { label: "B", href: "javascript:x" },
          { label: "C", href: "/c" },
        ],
      }),
    ).toEqual({
      headline: "H",
      ctas: [
        { label: "A", href: "/a" },
        { label: "B", href: "" },
      ],
    });
  });
});
