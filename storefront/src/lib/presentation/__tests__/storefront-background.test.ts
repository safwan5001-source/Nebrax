import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import { normalizeStorefrontBackground } from "../storefront-background";
import { PRESENTATION_CONFIG_VERSION } from "../tokens";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "..",
      "tests/Fixtures/presentation/storefront-background.json",
    ),
    "utf8",
  ),
) as { cases: Array<{ name: string; input: unknown; expected: unknown }> };

describe("StorefrontBackground contract (P3-A-02)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      expect(normalizeStorefrontBackground(testCase.input)).toEqual(
        testCase.expected,
      );
    });
  }

  it("keeps PRESENTATION_CONFIG_VERSION at 3 for additive compatibility", () => {
    expect(PRESENTATION_CONFIG_VERSION).toBe(3);
    expect(normalizePresentationConfig({}).version).toBe(3);
  });

  it("new background wins over editable legacy backgroundColor", () => {
    const result = normalizePresentationConfig({
      backgroundColor: "#ffffff",
      background: {
        kind: "solid",
        color: { hex: "#123456" },
      },
    });
    expect(result.background).toEqual({
      kind: "solid",
      color: { hex: "#123456" },
    });
    expect(result.backgroundColor).toBe("#ffffff");
  });

  it("does not add a new background key to legacy documents", () => {
    const result = normalizePresentationConfig({ backgroundColor: "#ffffff" });
    expect(result).toHaveProperty("backgroundColor", "#ffffff");
    expect(result).not.toHaveProperty("background");
  });

  it("drops invalid new background rather than silently changing the legacy field in preview normalization", () => {
    const result = normalizePresentationConfig({
      backgroundColor: "#ffffff",
      background: { kind: "solid", color: { hex: "not-a-color" } },
    });
    expect(result).not.toHaveProperty("background");
    expect(result.backgroundColor).toBe("#ffffff");
  });
});
