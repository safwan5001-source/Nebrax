"use client";

/**
 * CUST-HV V6b-4a — the proven contrast bounds of every picture a section background can show, read
 * from the server (`derivatives/status` → `contrast`), so the editor's live verdict and the Canvas
 * use the very numbers the publish gate will use (V0 §3.2.1). Read-only: it never generates.
 *
 * `lookup` is what `DesignContext.mediaBounds` expects (sync; `null` = unproven). `stateOf` tells the
 * inspector *why* it is unproven: still `loading`, or `unavailable` (no valid evidence — a picture
 * that predates evidence, a translucent one, or a framed usage that failed).
 * A framed usage that is still being generated is polled (bounded) until it settles; a stale
 * response never overwrites a newer one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  mediaRefTransform,
  usageStatus,
  type UsageContrast,
} from "@/modules/commerce-workspace/storefront-media";
import type { MediaRef } from "../presentation/media-ref";
import type { SectionDesign } from "../presentation/section-design";
import type { MediaBounds } from "../presentation/section-design-resolve";

export type BoundsState = "loading" | "ready" | "unavailable";

export interface BackgroundMediaBounds {
  lookup: (ref: MediaRef) => MediaBounds | null;
  stateOf: (ref: MediaRef) => BoundsState;
}

type Entry = { state: BoundsState; bounds: UsageContrast | null };

const POLL_MS = 2000;
const MAX_POLLS = 30;

function usageKey(ref: MediaRef): string {
  return JSON.stringify([ref.mediaId, mediaRefTransform(ref)]);
}

/** Every picture of every visible picture background (a hidden section never blocks publishing). */
export function backgroundPictureRefs(
  sections: ReadonlyArray<{ visible: boolean; design?: SectionDesign }>,
): MediaRef[] {
  const out: MediaRef[] = [];
  for (const section of sections) {
    const bg = section.design?.background;
    if (!section.visible || bg?.kind !== "media") continue;
    out.push(bg.media);
    if (bg.mobile) out.push(bg.mobile);
  }
  return out;
}

export function useBackgroundMediaBounds(
  sections: ReadonlyArray<{ visible: boolean; design?: SectionDesign }>,
): BackgroundMediaBounds {
  const refs = backgroundPictureRefs(sections);
  const signature = refs.map(usageKey).join("|");
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const generation = useRef(0);
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    const token = ++generation.current;
    const wanted = new Map<string, MediaRef>();
    for (const ref of refsRef.current) wanted.set(usageKey(ref), ref);
    let live = true;

    for (const [key, ref] of wanted) {
      void (async () => {
        for (let attempt = 0; attempt <= MAX_POLLS; attempt += 1) {
          try {
            const status = await usageStatus(ref.mediaId, mediaRefTransform(ref));
            if (!live || token !== generation.current) return;
            const settled = status.contrast !== null || status.state !== "processing";
            setEntries((prev) => ({
              ...prev,
              [key]: status.contrast
                ? { state: "ready", bounds: status.contrast }
                : { state: settled ? "unavailable" : "loading", bounds: null },
            }));
            if (settled) return;
          } catch {
            if (!live || token !== generation.current) return;
            setEntries((prev) => ({ ...prev, [key]: { state: "unavailable", bounds: null } }));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      })();
    }
    return () => {
      live = false;
    };
  }, [signature]);

  return useMemo<BackgroundMediaBounds>(
    () => ({
      lookup: (ref) => {
        const entry = entries[usageKey(ref)];
        return entry?.bounds ? { min: entry.bounds.min, max: entry.bounds.max } : null;
      },
      stateOf: (ref) => entries[usageKey(ref)]?.state ?? "loading",
    }),
    [entries],
  );
}
