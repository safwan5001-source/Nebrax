import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../presentation/config";
import { normalizeStorefrontBackground } from "../presentation/storefront-background";
import { PRESENTATION_CONFIG_VERSION } from "../presentation/tokens";

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "..", "tests/Fixtures/presentation/storefront-background.json"), "utf8"),
) as { cases: Array<{ name: string; input: unknown; expected: unknown }> };

describe("StorefrontBackground contract (P3-A-02)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      expect(normalizeStorefrontBackground(testCase.input)).toEqual(testCase.expected);
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
    expect(result.background).toEqual({ kind: "solid", color: { hex: "#123456" } });
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

  it("never carries URL, CSS, animation, or video fields into the canonical media ref", () => {
    const result = normalizePresentationConfig({
      background: {
        kind: "media",
        media: {
          mediaId: "0B8F6C2E-3D3A-4A53-9C7E-8F1A2B3C4D5E",
          url: "https://evil.example/background.jpg",
          style: "background-image: url(https://evil.example)",
          animation: "spin",
          video: "https://evil.example/video.mp4",
          autoplay: true,
        },
      },
    });

    expect(result.background).toEqual({
      kind: "media",
      media: {
        mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e",
        decorative: true,
      },
    });
    expect(JSON.stringify(result.background)).not.toMatch(/url|style|animation|video|autoplay/i);
  });
});
