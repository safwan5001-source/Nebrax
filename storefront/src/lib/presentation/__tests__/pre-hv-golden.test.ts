import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";

/**
 * CUST-HV V11 — backward compatibility (V0 §2.2). A document written with only pre-Horizon keys normalizes to exactly what the pre-Horizon
 * authority produced (fixture shared with the PHP and web twins): no new key appears for a document that never chose one.
 */
// Both apps run vitest from their own directory (one level below the repo root).
const golden = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "..",
      "tests/Fixtures/presentation/pre-hv-golden.json",
    ),
    "utf8",
  ),
) as { input: unknown; expected: unknown };

describe("pre-Horizon golden document", () => {
  it("normalizes byte for byte as before the Horizon", () => {
    expect(JSON.stringify(normalizePresentationConfig(golden.input))).toBe(
      JSON.stringify(golden.expected),
    );
  });

  it("the golden output is a fixed point", () => {
    expect(JSON.stringify(normalizePresentationConfig(golden.expected))).toBe(
      JSON.stringify(golden.expected),
    );
  });
});
