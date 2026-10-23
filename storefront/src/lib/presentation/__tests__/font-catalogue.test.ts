import { existsSync, readFileSync } from "node:fs";
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

  it("the global font selector (fontPreset) offers every catalogue key; the legacy two keep their exact stacks", () => {
    expect(FONT_PRESETS.map((preset) => preset.id)).toEqual([
      ...FONT_FAMILY_KEYS,
    ]);
    expect(FONT_PRESETS.slice(0, 2).map((preset) => preset.labelKey)).toEqual([
      "fontCairoGeist",
      "fontTajawalGeist",
    ]);
    for (const preset of FONT_PRESETS)
      expect(fontPresetFamilyStack(preset.id)).toBe(fontFamilyStack(preset.id));
    expect(fontPresetFamilyStack("cairo-geist")).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );
    expect(fontPresetFamilyStack("tajawal-geist")).toBe(
      "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif",
    );
  });

  it("PHP presentation FONT_PRESETS is the catalogue authority (single list)", () => {
    const php = read(
      "app/Support/Commerce/StorefrontPresentationNormalizer.php",
    );
    expect(php).toMatch(
      /FONT_PRESETS\s*=\s*StorefrontGlobalTokensNormalizer::FONT_FAMILIES;/,
    );
  });

  it("is append-only: the original eight keys keep their position and stack (Typography Library Expansion)", () => {
    expect(FONT_FAMILY_KEYS.slice(0, 8)).toEqual([
      "cairo-geist",
      "tajawal-geist",
      "plex-arabic",
      "noto-inter",
      "readex",
      "rubik",
      "el-messiri",
      "amiri-lora",
    ]);
    expect(fontFamilyStack("readex")).toBe(
      "var(--font-readex), system-ui, sans-serif",
    );
    expect(fontFamilyStack("amiri-lora")).toBe(
      "var(--font-lora), var(--font-amiri), Georgia, serif",
    );
  });

  it("adds almarai, alexandria, noto-kufi and reem-kufi, with unique display names (no duplicate option)", () => {
    for (const key of ["almarai", "alexandria", "noto-kufi", "reem-kufi"])
      expect(FONT_FAMILY_KEYS).toContain(key);
    const names = FONT_CATALOGUE.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ships the three Thmanyah families from the official WOFF2 files, loaded only when used", () => {
    for (const key of [
      "thmanyah-sans",
      "thmanyah-serif-display",
      "thmanyah-serif-text",
    ])
      expect(FONT_FAMILY_KEYS).toContain(key);
    for (const file of [
      "storefront/src/components/layout/DocumentShell.tsx",
      "web/src/modules/store-experience-builder/presentation/fonts.ts",
    ]) {
      const source = read(file);
      const calls = [...source.matchAll(/=\s*localFont\(\{([\s\S]*?)\}\);/g)];
      expect(calls.length, file).toBe(3);
      for (const [, body] of calls) {
        expect(body).toContain('display: "swap"');
        expect(body).toContain("preload: false");
        expect(body).not.toMatch(/https?:/);
        for (const weight of ["400", "500", "700", "900"])
          expect(body).toContain(`weight: "${weight}"`);
      }
    }
  });

  it("every referenced Thmanyah file exists next to the module, unmodified WOFF2, and the licence is on file", () => {
    for (const [file, dir] of [
      [
        "storefront/src/components/layout/DocumentShell.tsx",
        "storefront/src/fonts/thmanyah",
      ],
      [
        "web/src/modules/store-experience-builder/presentation/fonts.ts",
        "web/src/modules/store-experience-builder/presentation/fonts/thmanyah",
      ],
    ] as const) {
      const paths = [
        ...read(file).matchAll(
          /path:\s*"[^"]*\/(thmanyah[a-z]+-[A-Za-z]+\.woff2)"/g,
        ),
      ].map((m) => m[1]);
      expect(paths.length).toBe(12);
      for (const name of paths) {
        const bytes = readFileSync(resolve(root, dir, name));
        expect(bytes.subarray(0, 4).toString("ascii"), name).toBe("wOF2");
      }
    }
    expect(existsSync(resolve(root, "docs/legal/thmanyah/LICENSE.pdf"))).toBe(
      true,
    );
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
          /--font-(plex|inter|noto|readex|rubik|el-messiri|lora|amiri|almarai|alexandria|reem)/.test(
            m[2],
          ),
        );
        expect(calls.length).toBe(12);
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
