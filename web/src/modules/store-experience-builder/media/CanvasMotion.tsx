"use client";

/**
 * AWJ-ANIMATED-MEDIA — the Canvas's twin of the storefront's `MotionToggle` (`components/ui/motion-picture.tsx`): the same
 * `data-motion-toggle` button, glyphs, placement and wording, so the preview shows exactly the control a visitor gets. Like the
 * storefront it is absent for a visitor/editor who prefers reduced motion (they get the still frame; the choice is theirs).
 *
 * Unlike the media picker's `MotionPreview` (a grid of library assets that never autoplays), the Canvas stands for the PUBLISHED
 * page, so an animated picture plays here by default and the toggle pauses it.
 */
import { type CSSProperties, useSyncExternalStore } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** `true` when the editor's OS asks for reduced motion; `false` on the server and where `matchMedia` is missing. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

export interface CanvasMotionLabels {
  pause: string;
  play: string;
}

/** Mirrors the storefront's `MOTION_TOGGLE_STYLE` (a section backdrop; the slider pill styles it with CSS instead). */
export const CANVAS_MOTION_TOGGLE_STYLE: CSSProperties = {
  position: "absolute",
  insetBlockEnd: "0.75rem",
  insetInlineEnd: "0.75rem",
  zIndex: 2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "2.5rem",
  minHeight: "2.5rem",
  borderRadius: "9999px",
  border: "1px solid rgba(255,255,255,0.6)",
  background: "rgba(0,0,0,0.6)",
  color: "#fff",
  cursor: "pointer",
};

export function CanvasMotionToggle({
  playing,
  onToggle,
  labels,
  style,
}: {
  playing: boolean;
  onToggle: () => void;
  labels: CanvasMotionLabels;
  style?: CSSProperties;
}) {
  // The accessible name carries the state ("Pause" while playing, "Play" while paused); no `aria-pressed`, which would
  // announce the state twice (APG: a toggle's label must not change when it also exposes a pressed state).
  const label = playing ? labels.pause : labels.play;
  return (
    <button type="button" data-motion-toggle="" aria-label={label} title={label} onClick={onToggle} style={style}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
      </svg>
    </button>
  );
}
