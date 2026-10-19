import { type MediaRef, normalizeMediaRef } from "./media-ref";
import { PALETTE_ROLES, type PaletteRole } from "./palette";
import type { ColorRef, MediaOverlay } from "./section-design";
import { isSafeHexColor } from "./tokens";

export const STOREFRONT_BACKGROUND_DIRECTIONS = [
  "to-end",
  "to-start",
  "to-bottom",
  "to-top",
  "to-bottom-end",
  "to-bottom-start",
  "to-top-end",
  "to-top-start",
] as const;
export type StorefrontBackgroundDirection =
  (typeof STOREFRONT_BACKGROUND_DIRECTIONS)[number];

const OVERLAY_ALPHAS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
] as const;
const ROLES: readonly PaletteRole[] = ["brand", "accent", ...PALETTE_ROLES];

export type StorefrontBackground =
  | { kind: "solid"; color: ColorRef }
  | {
      kind: "gradient";
      from: ColorRef;
      to: ColorRef;
      direction: StorefrontBackgroundDirection;
    }
  | {
      kind: "media";
      media: MediaRef;
      mobile?: MediaRef;
      overlay?: MediaOverlay;
    };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function color(value: unknown): ColorRef | null {
  const raw = record(value);
  if (!raw) return null;
  if (typeof raw.role === "string" && ROLES.includes(raw.role as PaletteRole)) {
    return { role: raw.role as PaletteRole };
  }
  if (typeof raw.hex === "string" && isSafeHexColor(raw.hex.trim())) {
    return { hex: raw.hex.trim().toLowerCase() };
  }
  return null;
}

function overlay(value: unknown): MediaOverlay | null {
  const raw = record(value);
  if (
    !raw ||
    !OVERLAY_ALPHAS.includes(raw.alpha as (typeof OVERLAY_ALPHAS)[number])
  )
    return null;
  const colour = color(raw.color) ?? { role: "overlay" as const };
  return { color: colour, alpha: raw.alpha as (typeof OVERLAY_ALPHAS)[number] };
}

/** P3-A-02: additive document-level contract; invalid objects normalize to absence. */
export function normalizeStorefrontBackground(
  raw: unknown,
): StorefrontBackground | null {
  if (raw === null || raw === undefined) return null;
  const value = record(raw);
  if (!value || typeof value.kind !== "string") return null;
  if (value.kind === "solid") {
    const colour = color(value.color);
    return colour ? { kind: "solid", color: colour } : null;
  }
  if (value.kind === "gradient") {
    const from = color(value.from);
    const to = color(value.to);
    const direction = STOREFRONT_BACKGROUND_DIRECTIONS.includes(
      value.direction as StorefrontBackgroundDirection,
    )
      ? (value.direction as StorefrontBackgroundDirection)
      : undefined;
    return from && to && direction
      ? { kind: "gradient", from, to, direction }
      : null;
  }
  if (value.kind === "media") {
    const media = normalizeMediaRef(value.media);
    if (!media) return null;
    const mobile = normalizeMediaRef(value.mobile);
    const wash = overlay(value.overlay);
    return {
      kind: "media",
      media: { ...media, decorative: true },
      ...(mobile ? { mobile: { ...mobile, decorative: true } } : {}),
      ...(wash ? { overlay: wash } : {}),
    };
  }
  return null;
}

/** A null value is the explicit editor action to clear the new background. */
export function hasStorefrontBackgroundObject(raw: unknown): boolean {
  return raw !== null && raw !== undefined;
}
