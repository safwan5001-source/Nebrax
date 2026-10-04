/**
 * FLOWERS-H9a / ADR-21 — data-backed section content (productShelf / discovery /
 * deliveryPromise). Twin of the same file in the other app and of the PHP
 * StorefrontPresentationDataSectionsTest: all three read the SAME fixture
 * (tests/Fixtures/presentation/data-sections.json), so none can drift silently.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deliveryPromiseContentOf,
  discoveryContentOf,
  normalizeOptionalSectionContent,
  productShelfContentOf,
  SHELF_LIMIT_DEFAULT,
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
    resolve(process.cwd(), "..", "tests/Fixtures/presentation/data-sections.json"),
    "utf8",
  ),
) as { cases: Case[] };

describe("data-backed section content (shared fixture)", () => {
  it("has cases for every new type", () => {
    const types = new Set(fixture.cases.map((c) => c.type));
    expect([...types].sort()).toEqual(["deliveryPromise", "discovery", "productShelf"]);
  });

  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const actual = normalizeOptionalSectionContent(testCase.type, testCase.input);
      if (testCase.expected === null) {
        expect(actual).toBeUndefined();
      } else {
        expect(actual).toEqual(testCase.expected);
      }
    });
  }

  it("omits content entirely when absent", () => {
    for (const type of ["productShelf", "discovery", "deliveryPromise"]) {
      expect(normalizeOptionalSectionContent(type, undefined)).toBeUndefined();
      expect(normalizeOptionalSectionContent(type, null)).toBeUndefined();
      expect(normalizeOptionalSectionContent(type, [])).toBeUndefined();
    }
  });

  it("is idempotent", () => {
    for (const testCase of fixture.cases) {
      const once = normalizeOptionalSectionContent(testCase.type, testCase.input);
      if (once === undefined) continue;
      expect(normalizeOptionalSectionContent(testCase.type, once)).toEqual(once);
    }
  });

  it("content readers fall back to empty defaults for a different type or no content", () => {
    expect(productShelfContentOf({ type: "banner" })).toEqual({
      title: "",
      deliverToday: false,
      limit: SHELF_LIMIT_DEFAULT,
    });
    expect(discoveryContentOf({ type: "productShelf" })).toEqual({
      title: "",
      axis: "facet",
      dimension: "",
      display: "tiles",
    });
    expect(deliveryPromiseContentOf({ type: "discovery" })).toEqual({ title: "", body: "" });
  });

  it("content readers return the stored content for the matching type", () => {
    const shelf = normalizeOptionalSectionContent("productShelf", {
      source: { kind: "collection", slug: "best-sellers" },
    }) as SectionContent;
    expect(productShelfContentOf({ type: "productShelf", content: shelf }).source).toEqual({
      kind: "collection",
      slug: "best-sellers",
    });
    const disc = normalizeOptionalSectionContent("discovery", { dimension: "occasion" }) as SectionContent;
    expect(discoveryContentOf({ type: "discovery", content: disc }).dimension).toBe("occasion");
    const promise = normalizeOptionalSectionContent("deliveryPromise", { body: "x" }) as SectionContent;
    expect(deliveryPromiseContentOf({ type: "deliveryPromise", content: promise }).body).toBe("x");
  });
});
