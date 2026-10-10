/**
 * CUST-HV V6c-1 (V0 §8.4, D-15, AMEND-7) — the optional Banner visibility window. Twin of the same file in the
 * other app and of the PHP StorefrontPresentationBannerWindowTest: all three read the SAME fixture
 * (tests/Fixtures/presentation/banner-window.json), so none can drift silently.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOptionalSectionContent } from "../section-content";

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
      "tests/Fixtures/presentation/banner-window.json",
    ),
    "utf8",
  ),
) as { cases: Case[] };

describe("banner window (shared fixture)", () => {
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

  it("only a banner accepts a window; other types drop it", () => {
    const content = {
      headline: "H",
      window: { startsAt: "2026-12-01T00:00:00Z" },
    };
    expect(
      normalizeOptionalSectionContent("categories", content),
    ).toBeUndefined();
  });
});
