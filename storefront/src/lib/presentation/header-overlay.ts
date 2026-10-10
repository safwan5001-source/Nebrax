/**
 * CUST-HV V7c-2 — the overlay-on-hero proof (contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-
 * ARCHITECTURE-CONTRACT.md §9.3). A header may be transparent over the hero's picture only when the header's
 * text is **provably** legible against everything that picture can show under the header band.
 *
 * `resolveHeaderOverlay` is the one pure decision, used by the published Home page and by the Canvas:
 *
 *  1. the document opted in (`header.design.mode === "overlay-hero"`);
 *  2. the **first visible** home section is a `hero` with a **picture** background (V6b: media with proven
 *     contrast bounds) whose layout is not `split` (a split hero's picture is half-covered, so the region the
 *     proof covers is not the region the header sits on) — anything else ⇒ `null`, i.e. silently `solid`
 *     (§9.3.1: never a transparent header over unknown content);
 *  3. the header text is the better of pure white / black over the picture **after the hero's own overlay**; if
 *     that cannot clear 4.5:1 against every pixel the picture can show, an automatic scrim — a constant-alpha
 *     wash of the opposite colour, **≤ 40 %**, painted by the header bands themselves — is tried at 20 / 30 / 40 %.
 *     Still unprovable ⇒ `null` (solid). The whole picture (not an average, not a band estimate) is the judged
 *     region, so the band — a subset of it — is covered a fortiori (§4.5.7).
 *
 * No publish gate: an unprovable overlay is not an error, it renders solid. The editor shows why it is inactive.
 */

import {
  autoForeground,
  channelBoundsInterval,
  composite,
  passes,
  worstRatioForHex,
} from "./contrast-engine";
import type { HeaderDesign } from "./header-design";
import {
  type DesignContext,
  mediaBackgroundBounds,
} from "./section-design-resolve";

/** The scrim alphas the resolver may use, in order of preference (V0 §9.3: ≤ 40 %). */
export const OVERLAY_SCRIM_ALPHAS = [0, 20, 30, 40] as const;
export type OverlayScrim = (typeof OVERLAY_SCRIM_ALPHAS)[number];

export interface HeaderOverlay {
  /** The hero instance that carries the marker and reserves the header's height. */
  sectionId: string;
  tone: "light" | "dark";
  /** Text / icon colour over the picture. */
  fg: "#ffffff" | "#000000";
  /** Constant-alpha wash painted by the header bands, as a percentage (0 = none). */
  scrim: OverlayScrim;
}

/** The slice of a home section the decision needs (structurally a `PresentationHomeSection`). */
export interface OverlayCandidateSection {
  id: string;
  type: string;
  visible: boolean;
  design?: {
    background?: unknown;
    layout?: unknown;
  };
}

/** Why an opted-in header is not overlaying — for the editor's one-line explanation. */
export type OverlayInactiveReason =
  | "no-hero"
  | "not-picture"
  | "split-layout"
  | "unprovable";

/** The structural part of the decision (no contrast): the eligible hero, or why there is none. */
export function overlayHeroCandidate(
  sections: readonly OverlayCandidateSection[],
):
  | { ok: true; section: OverlayCandidateSection }
  | { ok: false; reason: Exclude<OverlayInactiveReason, "unprovable"> } {
  const first = sections.find((section) => section.visible);
  if (!first || first.type !== "hero") return { ok: false, reason: "no-hero" };
  const background = first.design?.background as { kind?: unknown } | undefined;
  if (!background || background.kind !== "media")
    return { ok: false, reason: "not-picture" };
  if (first.design?.layout === "split")
    return { ok: false, reason: "split-layout" };
  return { ok: true, section: first };
}

/** Stack a constant-alpha wash over channel bounds, widened by one level for the extra 8-bit rounding. */
function widen(
  rgb: readonly [number, number, number],
): [number, number, number] {
  return [
    Math.max(0, rgb[0] - 1),
    Math.max(0, rgb[1] - 1),
    Math.max(0, rgb[2] - 1),
  ];
}
function widenUp(
  rgb: readonly [number, number, number],
): [number, number, number] {
  return [
    Math.min(255, rgb[0] + 1),
    Math.min(255, rgb[1] + 1),
    Math.min(255, rgb[2] + 1),
  ];
}

export function resolveHeaderOverlay(
  design: HeaderDesign | undefined,
  sections: readonly OverlayCandidateSection[],
  ctx: DesignContext,
): { overlay: HeaderOverlay } | { reason: OverlayInactiveReason } | null {
  if (design?.mode !== "overlay-hero") return null;
  const candidate = overlayHeroCandidate(sections);
  if (!candidate.ok) return { reason: candidate.reason };
  const background = candidate.section.design?.background as Parameters<
    typeof mediaBackgroundBounds
  >[0];
  const bounds = mediaBackgroundBounds(background, ctx);
  if (!bounds) return { reason: "unprovable" };

  // What the picture shows after the hero's own overlay (channel bounds, not a luminance estimate).
  let lo: [number, number, number] = [...bounds.min];
  let hi: [number, number, number] = [...bounds.max];
  if (bounds.overlay) {
    lo = composite(bounds.overlay.rgb, bounds.overlay.alpha, lo);
    hi = composite(bounds.overlay.rgb, bounds.overlay.alpha, hi);
  }
  const base = channelBoundsInterval(lo, hi, null);
  const fg = autoForeground(base);
  const wash =
    fg === "#ffffff" ? ([0, 0, 0] as const) : ([255, 255, 255] as const);

  for (const scrim of OVERLAY_SCRIM_ALPHAS) {
    const interval =
      scrim === 0
        ? channelBoundsInterval(widen(lo), widenUp(hi), null)
        : channelBoundsInterval(widen(lo), widenUp(hi), {
            rgb: wash,
            alpha: scrim / 100,
          });
    if (passes(worstRatioForHex(fg, interval))) {
      return {
        overlay: {
          sectionId: candidate.section.id,
          tone: fg === "#ffffff" ? "light" : "dark",
          fg,
          scrim,
        },
      };
    }
  }
  return { reason: "unprovable" };
}

/**
 * The marker tokens the active hero frame carries (`data-ho`) — the stylesheet turns them into the header's
 * foreground and scrim through `:has()`, so the decision made on the server reaches the header without a
 * client round trip: `on` · `l`/`d` (tone) · `s2`/`s3`/`s4` (scrim 20/30/40 %).
 */
export function overlayMarker(overlay: HeaderOverlay): string {
  const tokens = ["on", overlay.tone === "light" ? "l" : "d"];
  if (overlay.scrim > 0) tokens.push(`s${overlay.scrim / 10}`);
  return tokens.join(" ");
}

/** Used by tests / the editor: the hex-parsed wash (kept here so the stylesheet's two colours stay in step). */
export const OVERLAY_WASH = { light: "0 0 0", dark: "255 255 255" } as const;
