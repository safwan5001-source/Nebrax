/**
 * P3-A-06 — editor twin of PHP `App\Support\Commerce\GlobalBackgroundContrast`, the publish authority for the
 * document-level global background (gradient or picture).
 *
 * The editor only *predicts* the server's verdict (so the merchant sees why a background will or will not publish
 * before pressing Publish); PHP re-judges at publish with the same engine and rejects with a stable code. Both run
 * `tests/Fixtures/presentation/global-background-contrast.json`.
 *
 * Policy (see the PHP class for the rationale): the page foregrounds that render directly on the page paint —
 * `--store-foreground`, `--store-muted-foreground`, the brand link colour — plus the explicit text of visible sections that
 * sit directly on the page, must keep {@link TEXT_NORMAL} over the **whole** luminance range of the paint. A gradient is
 * judged by `gradientInterval` (an interior dip is caught; direction does not enter), a picture by its worst-case pixel
 * evidence under the overlay united with the `backgroundColor` fallback. Unproven = failed. Solid backgrounds are outside it.
 */
import {
  channelBoundsInterval,
  gradientInterval,
  type LuminanceInterval,
  parseHex,
  passes,
  solidInterval,
  worstRatioForHex,
} from "./contrast-engine";
import type { StorefrontPresentationConfig } from "./config";
import { type ColorRef, OVERLAY_ALPHAS } from "./section-design";
import {
  type DesignContext,
  type MediaBounds,
  mediaBackgroundBounds,
  PAGE_BACKGROUND,
  SURFACE_OWNING_TYPES,
} from "./section-design-resolve";
import { resolveRoleHex } from "./palette";
import type { MediaRef } from "./media-ref";

/** `--store-foreground` / `--store-muted-foreground` in `storefront/src/app/globals.css` (fixed: no dark page tokens). */
export const GLOBAL_FOREGROUND_TEXT = "#111827";
export const GLOBAL_FOREGROUND_MUTED = "#636a78";

export type GlobalForegroundRole = "text" | "muted" | "brand";

type Config = Pick<
  StorefrontPresentationConfig,
  "primaryColor" | "accentColor" | "palette" | "backgroundColor" | "background" | "homepage"
>;

/** Light sections that own a white surface (twin of PHP `SectionDesignContrast::LEGACY_SURFACE`). */
const LEGACY_SURFACE_TYPES: ReadonlySet<string> = new Set(["banner", "deliveryPromise"]);

export interface GlobalPaint {
  kind: "gradient" | "media" | null;
  interval: LuminanceInterval | null;
  reason: "colour_unresolved" | "unproven" | null;
}

export function globalForegrounds(config: Pick<Config, "primaryColor">): Record<GlobalForegroundRole, string> {
  const brand = parseHex(config.primaryColor) ? config.primaryColor : "#12372a";
  return { text: GLOBAL_FOREGROUND_TEXT, muted: GLOBAL_FOREGROUND_MUTED, brand };
}

function ctxOf(config: Config, mediaBounds?: (ref: MediaRef) => MediaBounds | null): DesignContext {
  return {
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    palette: config.palette,
    dir: "ltr",
    ...(mediaBounds ? { mediaBounds } : {}),
  };
}

function resolve(ref: ColorRef | undefined, config: Config): readonly [number, number, number] | null {
  if (!ref) return null;
  if ("role" in ref) return parseHex(resolveRoleHex(ref.role, config));
  return parseHex(ref.hex);
}

/** The luminance range the page can paint, or why it cannot be proven. Twin of PHP `paint()`. */
export function globalBackgroundPaint(
  config: Config,
  mediaBounds?: (ref: MediaRef) => MediaBounds | null,
): GlobalPaint {
  const background = config.background;
  if (background?.kind === "gradient") {
    const from = resolve(background.from, config);
    const to = resolve(background.to, config);
    if (!from || !to) return { kind: "gradient", interval: null, reason: "colour_unresolved" };
    return { kind: "gradient", interval: gradientInterval(from, to), reason: null };
  }
  if (background?.kind === "media") {
    const bounds = mediaBackgroundBounds(background, ctxOf(config, mediaBounds));
    if (!bounds) return { kind: "media", interval: null, reason: "unproven" };
    const picture = channelBoundsInterval(bounds.min, bounds.max, bounds.overlay);
    // The fallback colour is what shows while the picture loads or if it never does.
    const fallback = parseHex(config.backgroundColor ?? "") ?? (parseHex(PAGE_BACKGROUND) as readonly [number, number, number]);
    const under = solidInterval(fallback);
    return {
      kind: "media",
      interval: { min: Math.min(picture.min, under.min), max: Math.max(picture.max, under.max) },
      reason: null,
    };
  }
  return { kind: null, interval: null, reason: null };
}

/** Foreground roles whose contrast is not proven over the paint. */
export function failingForegrounds(
  foregrounds: Record<GlobalForegroundRole, string>,
  interval: LuminanceInterval,
): GlobalForegroundRole[] {
  return (Object.keys(foregrounds) as GlobalForegroundRole[]).filter(
    (role) => !passes(worstRatioForHex(foregrounds[role], interval)),
  );
}

export interface SectionTextIssue {
  /** Index in `homepage.sections`. */
  index: number;
  field: "body" | "heading" | "link";
}

/** Explicit text of visible sections sitting directly on the page, judged against the real paint. */
export function pageTextIssues(config: Config, interval: LuminanceInterval): SectionTextIssue[] {
  const issues: SectionTextIssue[] = [];
  config.homepage.sections.forEach((section, index) => {
    const design = section.design;
    if (section.visible !== true || !design) return;
    if (design.background || SURFACE_OWNING_TYPES.has(section.type) || LEGACY_SURFACE_TYPES.has(section.type)) return;
    for (const field of ["body", "heading", "link"] as const) {
      const rgb = resolve(design.text?.[field], config);
      if (!rgb) continue;
      const hex = `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      if (!passes(worstRatioForHex(hex, interval))) issues.push({ index, field });
    }
  });
  return issues;
}

export type GlobalBackgroundStatus = "none" | "ready" | "insufficient" | "unproven" | "unresolved";

export interface GlobalBackgroundVerdict {
  kind: "gradient" | "media" | null;
  status: GlobalBackgroundStatus;
  /** Foreground roles that fail over the paint. */
  failing: GlobalForegroundRole[];
  /** Explicit section texts that fail over the paint. */
  sectionText: SectionTextIssue[];
  interval: LuminanceInterval | null;
}

/** What the server will decide about the background's contrast, as far as the editor can tell. */
export function globalBackgroundVerdict(
  config: Config,
  mediaBounds?: (ref: MediaRef) => MediaBounds | null,
): GlobalBackgroundVerdict {
  const paint = globalBackgroundPaint(config, mediaBounds);
  if (paint.kind === null) return { kind: null, status: "none", failing: [], sectionText: [], interval: null };
  if (!paint.interval) {
    return {
      kind: paint.kind,
      status: paint.reason === "colour_unresolved" ? "unresolved" : "unproven",
      failing: [],
      sectionText: [],
      interval: null,
    };
  }
  const failing = failingForegrounds(globalForegrounds(config), paint.interval);
  const sectionText = pageTextIssues(config, paint.interval);
  return {
    kind: paint.kind,
    status: failing.length === 0 && sectionText.length === 0 ? "ready" : "insufficient",
    failing,
    sectionText,
    interval: paint.interval,
  };
}

/**
 * The weakest approved *light* overlay (the `surface` role) that makes the picture's background ready, keeping the rest of
 * the document as is — or `null` when no approved strength can (a very dark picture cannot be rescued: the proof is the
 * worst pixel). A suggestion the merchant applies explicitly; the verdict itself is still the policy's.
 */
export function suggestLightOverlay(
  config: Config,
  mediaBounds: (ref: MediaRef) => MediaBounds | null,
): (typeof OVERLAY_ALPHAS)[number] | null {
  const background = config.background;
  if (background?.kind !== "media") return null;
  for (const alpha of OVERLAY_ALPHAS) {
    const trial = { ...config, background: { ...background, overlay: { color: { role: "surface" as const }, alpha } } };
    if (globalBackgroundVerdict(trial, mediaBounds).status === "ready") return alpha;
  }
  return null;
}
