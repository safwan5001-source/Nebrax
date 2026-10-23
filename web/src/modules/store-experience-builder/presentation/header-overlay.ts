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
 * **No scrim unless the merchant asks for one (AWJ decision, V7c-2; extended by AWJ-HEADER-SCRIM).** V7c-2 added none: the
 * header text and the hero's own text are judged against the *same* whole-picture interval, so a hero eligible here already
 * passes with no scrim. That left a real gap: a picture whose evidence spans nearly the whole range (any photograph with a
 * white and a black pixel — the evidence is the picture's exact per-channel min / max) can never pass, whatever the colour,
 * so an opted-in header stayed solid with nothing the merchant could do. `design.overlayScrim: "auto"` fills exactly that
 * gap: the header's own rows get a translucent layer in the colour OPPOSITE to the text (white behind black text, black
 * behind white text), at the weakest strength (30 … 80 %, steps of 10) for which the text is proven ≥ 4.5:1 over the
 * picture composited with it. It never darkens the rest of the picture, it is never added when the picture alone proves the
 * text, and the V0 §9.3.3 figure of ≤ 40 % is superseded for this explicit opt-in: 40 % white over a black pixel gives only
 * ≈ 3.7:1 under black text, so no weaker layer can prove a full-range picture. (A per-band region proof — evidence for the
 * header's band only — would need less; it needs new media evidence and is not built.)
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

/** The strengths (percent) a protection layer may take, weakest first. */
export const SCRIM_ALPHAS = [30, 40, 50, 60, 70, 80] as const;
export type ScrimAlpha = (typeof SCRIM_ALPHAS)[number];

export interface HeaderOverlay {
  /** The hero instance that carries the marker and reserves the header's height. */
  sectionId: string;
  tone: "light" | "dark";
  /** Text / icon colour over the picture. */
  fg: "#ffffff" | "#000000";
  /**
   * AWJ-HEADER-SCRIM — present only when the picture alone could not prove the text and the merchant opted in with
   * `overlayScrim: "auto"`: the layer behind the header rows (colour = opposite of `fg`) and its proven strength.
   */
  scrim?: { alpha: ScrimAlpha };
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
  | "tone-unprovable"
  | "scrim-unprovable";

/** The structural part of the decision (no contrast): the eligible hero, or why there is none. */
export function overlayHeroCandidate(
  sections: readonly OverlayCandidateSection[],
):
  | { ok: true; section: OverlayCandidateSection }
  | {
      ok: false;
      reason: Exclude<
        OverlayInactiveReason,
        "unprovable" | "tone-unprovable" | "scrim-unprovable"
      >;
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
    // AWJ-HEADER-SCRIM — the picture alone cannot prove it; a merchant who opted in gets a layer behind the header rows
    if (design.overlayScrim === "auto") {
      const protectedTone = protectWithScrim(lo, hi, forced);
      if (!protectedTone) return { reason: "scrim-unprovable" };
      return {
        overlay: {
          sectionId: candidate.section.id,
          tone: protectedTone.fg === "#ffffff" ? "light" : "dark",
          fg: protectedTone.fg,
          scrim: { alpha: protectedTone.alpha },
        },
      };
    }
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

/**
 * The weakest strength at which `fg` over the picture (channel bounds `lo`..`hi` after the hero's own overlay) composited with
 * a layer of the OPPOSITE colour clears 4.5:1 over the whole range — per tone; with no forced tone both are tried and the
 * weaker layer wins (a tie keeps the better-of-white/black first choice). `null` = even the strongest step is not enough.
 */
function protectWithScrim(
  lo: [number, number, number],
  hi: [number, number, number],
  forced: "#ffffff" | "#000000" | null,
): { fg: "#ffffff" | "#000000"; alpha: ScrimAlpha } | null {
  const whole = channelBoundsInterval(lo, hi, null);
  const first = autoForeground(whole);
  const tones: Array<"#ffffff" | "#000000"> = forced
    ? [forced]
    : [first, first === "#ffffff" ? "#000000" : "#ffffff"];
  let best: { fg: "#ffffff" | "#000000"; alpha: ScrimAlpha } | null = null;
  for (const fg of tones) {
    const rgb: [number, number, number] =
      fg === "#ffffff" ? [0, 0, 0] : [255, 255, 255];
    for (const alpha of SCRIM_ALPHAS) {
      const under = channelBoundsInterval(lo, hi, { rgb, alpha: alpha / 100 });
      if (passes(worstRatioForHex(fg, widened(under)))) {
        if (!best || alpha < best.alpha) best = { fg, alpha };
        break;
      }
    }
  }
  return best;
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
  const tone = overlay.tone === "light" ? "l" : "d";
  // AWJ-HEADER-SCRIM — `s3` … `s8` = a protection layer of 30 … 80 %; absent ⇒ exactly the marker V7c-2 always emitted
  return overlay.scrim
    ? `on ${tone} s${overlay.scrim.alpha / 10}`
    : `on ${tone}`;
}
