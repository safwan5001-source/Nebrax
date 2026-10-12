import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../presentation";

interface Fixture {
  cases: Array<{ name: string; input: unknown; expected: unknown }>;
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../tests/Fixtures/presentation/section-labels.json"), "utf8"),
) as Fixture;

const documentWith = (section: unknown) => ({
  version: 2,
  primaryColor: "#12372a",
  homepage: { sections: [section] },
});

/**
 * CUST-HV V10c — the merchant-app twin of PHP's section-label normalisation, pinned by the shared fixture. Key order is compared
 * through JSON (id · type · visible · label · content · design).
 */
describe("section labels — normalisation", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const first = normalizePresentationConfig(documentWith(c.input)).homepage.sections[0];
      expect(JSON.stringify(first)).toBe(JSON.stringify(c.expected));
      const again = normalizePresentationConfig(documentWith(first)).homepage.sections[0];
      expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    });
  }
});
