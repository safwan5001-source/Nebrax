/**
 * CUST-HV V5a — palette roles (contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-
 * ARCHITECTURE-CONTRACT.md §4.1).
 *
 * `brand` is `primaryColor` and `accent` is `accentColor` — existing keys, no
 * second source of truth. This additive `palette` object holds only the other
 * roles. Absent roles keep today's fixed token, so a document without `palette`
 * renders exactly as before (null = "use the token that is in use today").
 *
 * Twin of `storefront/src/lib/presentation/palette.ts` (byte-identical) and of
 * PHP `StorefrontPresentationNormalizer::normalizePalette`; pinned by
 * `tests/Fixtures/presentation/palette.json`.
 */
import { isSafeHexColor, mixHex } from "./tokens";

export const PALETTE_ROLES = [
  "surface",
  "surfaceAlt",
  "text",
  "heading",
  "link",
  "border",
  "overlay",
] as const;
export type PaletteRoleKey = (typeof PALETTE_ROLES)[number];
export type PresentationPalette = Partial<Record<PaletteRoleKey, string>>;

/** Every role a colour can reference (V0 §3.2 `PaletteRole`). */
export type PaletteRole = "brand" | "accent" | PaletteRoleKey;

/**
 * Lenient + deterministic: each role is kept or dropped on its own, hex only,
 * lower-cased (one canonical form), fixed role order. `undefined` = absent.
 */
export function normalizePalette(
  raw: unknown,
): PresentationPalette | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const out: PresentationPalette = {};
  for (const role of PALETTE_ROLES) {
    const value =
      typeof source[role] === "string" ? (source[role] as string).trim() : "";
    if (isSafeHexColor(value)) out[role] = value.toLowerCase();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface ResolvedPalette {
  brand: string;
  /** `null` = the merchant set no accent: keep today's colour at every accent site. */
  accent: string | null;
  surface: string | null;
  surfaceAlt: string | null;
  text: string | null;
  heading: string | null;
  link: string | null;
  border: string | null;
  overlay: string | null;
}

/**
 * `null` never means "black" — it means *no merchant choice*; the renderer then
 * uses the fixed token it uses today. That is what makes absent palette ⇒ unchanged.
 */
export function resolvePalette(config: {
  primaryColor: string;
  accentColor: string | null;
  palette?: PresentationPalette;
}): ResolvedPalette {
  const p = config.palette ?? {};
  return {
    brand: config.primaryColor,
    accent:
      config.accentColor && isSafeHexColor(config.accentColor)
        ? config.accentColor
        : null,
    surface: p.surface ?? null,
    surfaceAlt: p.surfaceAlt ?? null,
    text: p.text ?? null,
    heading: p.heading ?? null,
    link: p.link ?? null,
    border: p.border ?? null,
    overlay: p.overlay ?? null,
  };
}

/**
 * Editor-only suggestion for the accent swatch (V0 §4.1 `derive(brand)`): a tint
 * of the brand. Never written to the document and never rendered unless the
 * merchant picks it — legacy `accentColor: null` documents render unchanged.
 */
export function suggestAccent(brand: string): string {
  return mixHex(brand, "#ffffff", 0.35);
}
