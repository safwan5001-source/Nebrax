import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../presentation/config";
import { normalizeMediaRef } from "../presentation/media-ref";

/**
 * CUST-HV V4a — the same fixture drives PHP `StorefrontMediaRefNormalizer`
 * and both TS twins, so the three cannot drift silently.
 */
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "tests/Fixtures/presentation/media-ref.json"),
    "utf8",
  ),
) as { cases: Array<{ name: string; input: unknown; expected: unknown }> };

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";

describe("media-ref normaliser (shared fixture)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      expect(normalizeMediaRef(testCase.input)).toEqual(testCase.expected);
    });
  }

  it("keeps a fixed key order, byte for byte with PHP", () => {
    const full = fixture.cases.find((c) => c.name.startsWith("full ref"));
    expect(Object.keys(normalizeMediaRef(full?.input) ?? {})).toEqual([
      "mediaId",
      "fit",
      "focal",
      "crop",
      "rotate",
      "alt",
      "decorative",
    ]);
  });
});

describe("branding media in the presentation config", () => {
  it("is additive: absent when not given, kept when valid, legacy fields untouched", () => {
    const plain = normalizePresentationConfig({ branding: { logoDataUrl: "https://cdn.example.com/a.png" } });
    expect(plain.branding).not.toHaveProperty("logoMedia");
    expect(plain.branding.logoDataUrl).toBe("https://cdn.example.com/a.png");

    const withMedia = normalizePresentationConfig({
      branding: {
        logoDataUrl: "https://cdn.example.com/a.png",
        logoMedia: { mediaId: ID.toUpperCase(), url: "https://evil.example/x.png" },
        compactLogoMedia: { mediaId: "nope" },
        faviconMedia: { mediaId: ID, decorative: true },
      },
    });
    expect(withMedia.branding.logoMedia).toEqual({ mediaId: ID });
    expect(withMedia.branding).not.toHaveProperty("compactLogoMedia");
    expect(withMedia.branding.faviconMedia).toEqual({ mediaId: ID, decorative: true });
    expect(withMedia.branding.logoDataUrl).toBe("https://cdn.example.com/a.png");
  });
});
