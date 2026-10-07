import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FONT_CATALOGUE,
  FONT_FAMILY_KEYS,
  fontFamilyStack,
} from "../font-catalogue";
import { FONT_PRESETS, fontPresetFamilyStack } from "../tokens";

const root = resolve(__dirname, "../../../../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("font catalogue (V5e-2c)", () => {
  it("has at least six entries, unique keys, and one catalogue entry per key", () => {
    expect(FONT_FAMILY_KEYS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(FONT_FAMILY_KEYS).size).toBe(FONT_FAMILY_KEYS.length);
    expect(FONT_CATALOGUE.map((entry) => entry.key)).toEqual([
      ...FONT_FAMILY_KEYS,
    ]);
  });

  it("the PHP authority lists exactly the same keys, in the same order", () => {
    const php = read(
      "app/Support/Commerce/StorefrontGlobalTokensNormalizer.php",
    );
    const list = php.match(/FONT_FAMILIES = \[([^\]]+)\]/);
    expect(list, "FONT_FAMILIES in the PHP normalizer").not.toBeNull();
    const keys = [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(keys).toEqual([...FONT_FAMILY_KEYS]);
  });

  it("the first two keys are the legacy fontPreset values and resolve to the exact same stacks", () => {
    expect(FONT_PRESETS.map((preset) => preset.id)).toEqual(
      FONT_FAMILY_KEYS.slice(0, 2),
    );
    for (const preset of FONT_PRESETS) {
      expect(fontFamilyStack(preset.id)).toBe(fontPresetFamilyStack(preset.id));
    }
  });

  it("only catalogue keys resolve — a name, a CSS string or a custom upload is never a stack", () => {
    expect(fontFamilyStack("Cairo")).toBeUndefined();
    expect(fontFamilyStack("custom:0a1b2c")).toBeUndefined();
    expect(fontFamilyStack("readex; x")).toBeUndefined();
    expect(fontFamilyStack(undefined)).toBeUndefined();
    expect(fontFamilyStack(null)).toBeUndefined();
  });

  for (const [label, file] of [
    [
      "storefront DocumentShell",
      "storefront/src/components/layout/DocumentShell.tsx",
    ],
    [
      "Canvas fonts module",
      "web/src/modules/store-experience-builder/presentation/fonts.ts",
    ],
  ] as const) {
    describe(label, () => {
      const source = read(file);
      const declared = new Set(
        [...source.matchAll(/variable:\s*"(--font-[a-z-]+)"/g)].map(
          (m) => m[1],
        ),
      );

      it("declares every CSS variable any catalogue stack references", () => {
        const used = new Set(
          FONT_CATALOGUE.flatMap((entry) =>
            [...entry.stack.matchAll(/var\((--font-[a-z-]+)\)/g)].map(
              (m) => m[1],
            ),
          ),
        );
        for (const name of used) expect(declared, name).toContain(name);
      });

      it("loads every catalogue face self-hosted, swapped, subsetted to Arabic/Latin and NOT preloaded", () => {
        const calls = [
          ...source.matchAll(
            /=\s*(?!Geist|Cairo|Tajawal)([A-Z][A-Za-z_]+)\(\{([\s\S]*?)\}\);/g,
          ),
        ].filter((m) =>
          /--font-(plex|inter|noto|readex|rubik|el-messiri|lora|amiri)/.test(
            m[2],
          ),
        );
        expect(calls.length).toBe(8);
        for (const [, name, body] of calls) {
          expect(body, name).toContain('display: "swap"');
          expect(body, name).toContain("preload: false");
          const subsets = [
            ...(body.match(/subsets:\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(
              /"([a-z-]+)"/g,
            ),
          ].map((m) => m[1]);
          expect(subsets.length, name).toBeGreaterThan(0);
          for (const subset of subsets)
            expect(["arabic", "latin"], `${name} ${subset}`).toContain(subset);
        }
      });

      it("never points the document at a third-party font CDN", () => {
        expect(source).not.toMatch(
          /fonts\.googleapis|fonts\.gstatic|@import|<link[^>]+font/i,
        );
      });
    });
  }
});
