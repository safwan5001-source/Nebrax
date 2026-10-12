import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { newArrivalsContentOf, normalizeOptionalSectionContent } from "../presentation/section-content";

interface Fixture {
  cases: Array<{ name: string; type: string; input: unknown; expected: unknown }>;
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../tests/Fixtures/presentation/shelf-titles.json"), "utf8"),
) as Fixture;

/**
 * CUST-HV V9d-3 — the TS twin of PHP's shelf title normalisation, pinned by the shared fixture. `expected: null` is the content being absent
 * (TS `undefined`).
 */
describe("shelf title — shared fixture (V9d-3)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(normalizeOptionalSectionContent(c.type, c.input) ?? null).toEqual(c.expected);
    });
    it(`${c.name} — idempotent, and key order is the contract`, () => {
      const once = normalizeOptionalSectionContent(c.type, c.input);
      expect(JSON.stringify(normalizeOptionalSectionContent(c.type, once))).toBe(JSON.stringify(once));
      if (c.expected) expect(JSON.stringify(once)).toBe(JSON.stringify(c.expected));
    });
  }
});

describe("newArrivalsContentOf", () => {
  it("is an empty object until a title or hide is authored, and only for the new-arrivals type", () => {
    expect(newArrivalsContentOf({ type: "newArrivals" })).toEqual({});
    expect(newArrivalsContentOf({ type: "newArrivals", content: { title: "Fresh", showTitle: false } })).toEqual({ title: "Fresh", showTitle: false });
    expect(newArrivalsContentOf({ type: "featured", content: { productIds: [], title: "x" } })).toEqual({});
  });
});
