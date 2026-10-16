"use client";

import { useTranslations } from "next-intl";
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type AnimatedPictureSources,
  REDUCED_MOTION_QUERY,
} from "@/lib/presentation/animated-sources";

/**
 * AWJ-ANIMATED-MEDIA P1 — a `<picture>` that can play an animated GIF/WebP and be paused.
 *
 *  - **Reduced motion** is resolved by the browser from the ordering in `animatedPictureSources` (poster
 *    `<source>`s first), so it holds before hydration and without JavaScript.
 *  - **Pause** (WCAG 2.2.2, V0 §6.6): an animated `<img>` cannot be paused, so pausing drops the animated
 *    `<source>`s and the browser re-resolves to the still ladder. A `MotionToggle` elsewhere in the tree
 *    flips the shared per-`id` state — the control and the picture are independent components, so the
 *    control can sit outside an `aria-hidden` decorative layer.
 *  - **No-JavaScript visitors never get motion they cannot stop (WCAG 2.2.2).** The server renders only the
 *    still ladder (the reduced-motion `<source>`s and the `<img>`); the animated `<source>`s are added after
 *    hydration, together with the pause control. As a side benefit the still paints first (LCP) and the
 *    animation file is fetched only once the page is interactive.
 */

const paused = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setPaused(id: string, value: boolean): void {
  paused.set(id, value);
  for (const listener of listeners) listener();
}

const noopSubscribe = () => () => undefined;

/** `false` on the server and during hydration, `true` afterwards (never flips back). */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function useMotionPaused(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => paused.get(id) === true,
    () => false,
  );
}

export function MotionPicture({
  id,
  sources,
  phoneStills,
  children,
  ...pictureProps
}: {
  id: string;
  sources: AnimatedPictureSources;
  /** The caller's existing phone-sized stills (slot 3). */
  phoneStills?: ReactNode;
  /** The caller's existing desktop WebP `<source>` and the `<img>` (slot 5). */
  children: ReactNode;
} & ComponentPropsWithoutRef<"picture">) {
  const isPaused = useMotionPaused(id);
  const hydrated = useHydrated();
  // Animated sources exist only while hydrated and not paused; the stills are always present.
  const live = (list: AnimatedPictureSources["leading"]) =>
    list.filter((s) => !(s.animated && (isPaused || !hydrated)));
  const toSource = (
    s: AnimatedPictureSources["leading"][number],
    key: string,
  ) => (
    <source
      key={key}
      media={s.media}
      type={s.type}
      srcSet={s.srcSet}
      sizes={s.sizes}
    />
  );

  return (
    <picture {...pictureProps}>
      {live(sources.leading).map((s, i) => toSource(s, `l${i}`))}
      {phoneStills}
      {live(sources.beforeDesktop).map((s, i) => toSource(s, `d${i}`))}
      {children}
    </picture>
  );
}

/**
 * The pause/play control. Not rendered until hydrated (no dead control without JS) and never for a visitor who
 * prefers reduced motion (they already get the still frame and the choice is theirs, not the page's).
 */
export function MotionToggle({
  id,
  className,
  style,
}: {
  id: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useTranslations("home.motion");
  const isPaused = useMotionPaused(id);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(query.matches);
    setReady(true);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  if (!ready || reduced) return null;
  const label = isPaused ? t("play") : t("pause");

  return (
    <button
      type="button"
      data-motion-toggle=""
      aria-pressed={isPaused}
      aria-label={label}
      title={label}
      onClick={() => setPaused(id, !isPaused)}
      className={className}
      style={style}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="currentColor"
      >
        {isPaused ? (
          <path d="M8 5v14l11-7z" />
        ) : (
          <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
        )}
      </svg>
    </button>
  );
}

/** The one shared look for the control (inline position beats the backdrop's `~ *` stacking rule). */
export const MOTION_TOGGLE_STYLE: React.CSSProperties = {
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
