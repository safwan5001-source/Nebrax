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
  /**
   * The accent ROLE value (V0 §4.1): `accentColor ?? derive(brand)` — always a colour,
   * so an explicit `{ role: "accent" }` reference in a design always resolves.
   */
  accent: string;
  /**
   * `true` when `accent` was derived because the merchant set no `accentColor`.
   * Existing accent *chrome* (badges, highlights…) must then keep today's colour —
   * legacy `accentColor: null` documents render unchanged (V0 §4.1).
   */
  accentIsDerived: boolean;
  surface: string | null;
  surfaceAlt: string | null;
  text: string | null;
  heading: string | null;
  link: string | null;
  border: string | null;
  overlay: string | null;
}

/**
 * Brand and accent always resolve (accent per V0 §4.1: `accentColor ?? derive(brand)`).
 * For the other roles `null` never means "black" — it means *no merchant choice*; the
 * renderer then uses the fixed token it uses today. That is what makes absent palette
 * ⇒ unchanged.
 */
export function resolvePalette(config: {
  primaryColor: string;
  accentColor: string | null;
  palette?: PresentationPalette;
}): ResolvedPalette {
  const p = config.palette ?? {};
  const explicitAccent =
    config.accentColor && isSafeHexColor(config.accentColor)
      ? config.accentColor
      : null;
  return {
    brand: config.primaryColor,
    accent: explicitAccent ?? suggestAccent(config.primaryColor),
    accentIsDerived: explicitAccent === null,
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

/**
 * Today's fixed storefront tokens — what an unset palette role renders as now
 * (`storefront/src/app/globals.css`). A section `design` that *references* a role
 * the merchant never set resolves to these, so it is deterministic and provable.
 */
export const ROLE_FALLBACK_HEX = {
  surface: "#ffffff",
  surfaceAlt: "#f3f4f6",
  text: "#111827",
  heading: "#111827",
  border: "#e5e7eb",
  overlay: "#000000",
} as const;

/** Always a concrete `#rrggbb`: the merchant's value, else the fixed token / derived value. */
export function resolveRoleHex(
  role: PaletteRole,
  config: {
    primaryColor: string;
    accentColor: string | null;
    palette?: PresentationPalette;
  },
): string {
  const resolved = resolvePalette(config);
  switch (role) {
    case "brand":
      return resolved.brand;
    case "accent":
      return resolved.accent;
    case "link":
      return resolved.link ?? resolved.brand;
    default:
      return resolved[role] ?? ROLE_FALLBACK_HEX[role];
  }
}
