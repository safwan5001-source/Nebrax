/**
 * CUST-HV V5e-2c — the curated font catalogue (contract: docs/plans/store/CUST-HV-V0-
 * DECISIONS-AND-ARCHITECTURE-CONTRACT.md §5.2, N-5).
 *
 * Rules (frozen in V0, verified for these entries at slice time):
 *  - **self-hosted, subsetted, OFL-class licences only** — every face is loaded through
 *    `next/font/google` (downloaded at build time and served from the store's own origin; the
 *    visitor's browser never contacts a font CDN) with only the `arabic` + `latin` subsets;
 *  - **Arabic + Latin coverage** in every entry — either one family carrying both scripts or a
 *    Latin face paired with an Arabic face (the Latin instance names the Arabic one as its
 *    `fallback`, see `DocumentShell`, so Arabic never falls to a local Arial);
 *  - `font-display: swap`, and **loaded only when used**: the catalogue faces are declared with
 *    `preload: false`, so no `<link rel="preload">` is emitted and the browser fetches a face's file
 *    only when the resolved `font-family` is used by rendered text.
 *
 * The first two keys are the legacy `fontPreset` values — `fontPreset` maps onto the catalogue so
 * an absent `typography.bodyFamily` renders exactly as before. `custom:<mediaId>` (a merchant
 * upload) is reserved by V0 §5.4 and is **not** enabled: it is not a catalogue key and is dropped.
 *
 * Twin of `web/.../presentation/font-catalogue.ts` (byte-identical, test-enforced) and of the PHP
 * `StorefrontGlobalTokensNormalizer::FONT_FAMILIES` (the authority); pinned by
 * `tests/Fixtures/presentation/global-tokens.json`.
 */
export const FONT_FAMILY_KEYS = [
  "cairo-geist",
  "tajawal-geist",
  "plex-arabic",
  "noto-inter",
  "readex",
  "rubik",
  "el-messiri",
  "amiri-lora",
] as const;

export type FontFamilyKey = (typeof FONT_FAMILY_KEYS)[number];

export interface FontFamilyEntry {
  key: FontFamilyKey;
  /** Display name — proper nouns, shown as is in both languages. */
  name: string;
  kind: "sans" | "display" | "serif";
  /** The complete CSS `font-family` stack (only `var(--font-*)` names declared by the document shell). */
  stack: string;
}

export const FONT_CATALOGUE: readonly FontFamilyEntry[] = [
  {
    key: "cairo-geist",
    name: "Cairo · Geist",
    kind: "sans",
    stack: "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
  },
  {
    key: "tajawal-geist",
    name: "Tajawal · Geist",
    kind: "sans",
    stack:
      "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif",
  },
  {
    key: "plex-arabic",
    name: "IBM Plex Sans Arabic",
    kind: "sans",
    stack: "var(--font-plex-arabic), system-ui, sans-serif",
  },
  {
    key: "noto-inter",
    name: "Noto Sans Arabic · Inter",
    kind: "sans",
    stack: "var(--font-inter), var(--font-noto-arabic), system-ui, sans-serif",
  },
  {
    key: "readex",
    name: "Readex Pro",
    kind: "sans",
    stack: "var(--font-readex), system-ui, sans-serif",
  },
  {
    key: "rubik",
    name: "Rubik",
    kind: "sans",
    stack: "var(--font-rubik), system-ui, sans-serif",
  },
  {
    key: "el-messiri",
    name: "El Messiri",
    kind: "display",
    stack: "var(--font-el-messiri), system-ui, sans-serif",
  },
  {
    key: "amiri-lora",
    name: "Amiri · Lora",
    kind: "serif",
    stack: "var(--font-lora), var(--font-amiri), Georgia, serif",
  },
];

/** The stack of a catalogue key; `undefined` for anything else (never a guess). */
export function fontFamilyStack(
  key: string | undefined | null,
): string | undefined {
  return FONT_CATALOGUE.find((entry) => entry.key === key)?.stack;
}
