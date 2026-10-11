import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePagePresentation } from "../page-regions";

interface Fixture {
  cases: Array<{ name: string; input: unknown; expected: unknown }>;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/product-zoom.json",
    ),
    "utf8",
  ),
) as Fixture;

/**
 * CUST-HV V9e — the TS twin of PHP's product-page `zoom` normalisation, pinned by the shared fixture (`expected: null` = nothing stored,
 * TS `undefined`). Key order is compared through JSON, so the canonical `version · regions · zoom` order is enforced too.
 */
describe("product page zoom — normalisation", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const out = normalizePagePresentation(c.input);
      expect(JSON.stringify(out ?? null)).toBe(JSON.stringify(c.expected));
      if (out) {
        expect(JSON.stringify(normalizePagePresentation(out))).toBe(
          JSON.stringify(out),
        );
      }
    });
  }
});
