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
 *  3. the header text is the better of pure white / black over the picture **after the hero's own overlay**, and
 *     must clear 4.5:1 against every pixel the picture can show; otherwise `null` (solid). The whole picture (not
 *     an average, not a band estimate) is the judged region, so the band — a subset of it — is covered a fortiori
 *     (§4.5.7).
 *
 * **No automatic scrim (AWJ decision, V7c-2).** V0 §9.3.3 allows a ≤ 40 % scrim "when needed". Under this proof it is
 * never needed: the header text and the hero's own text are judged against the *same* whole-picture interval with
 * the same better-of-white/black rule, and a hero whose text cannot be proven does not render its picture at all
 * (`mbg` is never emitted) — so a hero that is eligible here already passes with no scrim, and one that does not
 * pass is not eligible. A scrim becomes meaningful only with a per-band region proof (a top-band-only evidence that
 * is more permissive than the whole picture), which does not exist yet.
 *
 * **Forced tone (AWJ-HEADER-OVERLAY-TONE).** `design.overlayTone` (`light` = white text, `dark` = black text) replaces the
 * automatic better-of-white/black choice but not the proof: the chosen colour must clear 4.5:1 over the same whole-picture
 * interval, else the header stays solid (`tone-unprovable`). The merchant can pick the look; never an unreadable header.
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

export interface HeaderOverlay {
  /** The hero instance that carries the marker and reserves the header's height. */
  sectionId: string;
  tone: "light" | "dark";
  /** Text / icon colour over the picture. */
  fg: "#ffffff" | "#000000";
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
  | "unprovable"
  | "tone-unprovable";

/** The structural part of the decision (no contrast): the eligible hero, or why there is none. */
export function overlayHeroCandidate(
  sections: readonly OverlayCandidateSection[],
):
  | { ok: true; section: OverlayCandidateSection }
  | {
      ok: false;
      reason: Exclude<OverlayInactiveReason, "unprovable" | "tone-unprovable">;
    } {
  const first = sections.find((section) => section.visible);
  if (!first || first.type !== "hero") return { ok: false, reason: "no-hero" };
  const background = first.design?.background as { kind?: unknown } | undefined;
  if (!background || background.kind !== "media")
    return { ok: false, reason: "not-picture" };
  if (first.design?.layout === "split")
    return { ok: false, reason: "split-layout" };
  return { ok: true, section: first };
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
  const lo = bounds.overlay
    ? composite(bounds.overlay.rgb, bounds.overlay.alpha, bounds.min)
    : bounds.min;
  const hi = bounds.overlay
    ? composite(bounds.overlay.rgb, bounds.overlay.alpha, bounds.max)
    : bounds.max;
  const interval = channelBoundsInterval(lo, hi, null);
  const forced = design.overlayTone
    ? design.overlayTone === "light"
      ? "#ffffff"
      : "#000000"
    : null;
  const fg = forced ?? autoForeground(interval);
  if (!passes(worstRatioForHex(fg, widened(interval)))) {
    return { reason: forced ? "tone-unprovable" : "unprovable" };
  }
  return {
    overlay: {
      sectionId: candidate.section.id,
      tone: fg === "#ffffff" ? "light" : "dark",
      fg,
    },
  };
}

/** One 8-bit level of slack on a luminance interval for the extra compositing step the browser performs. */
function widened(interval: { min: number; max: number }) {
  const level = 1 / 255;
  return {
    min: Math.max(0, interval.min - level),
    max: Math.min(1, interval.max + level),
  };
}

/**
 * The marker tokens the active hero frame carries (`data-ho`) — the stylesheet turns them into the header's
 * foreground through `:has()`, so the decision made on the server reaches the header without a client round
 * trip: `on` · `l` (white text) / `d` (black text).
 */
export function overlayMarker(overlay: HeaderOverlay): string {
  return `on ${overlay.tone === "light" ? "l" : "d"}`;
}
