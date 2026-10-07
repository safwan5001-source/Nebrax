"use client";

/**
 * CUST-HV V6b-4a — the proven contrast bounds of every picture a section background can show, read
 * from the server (`derivatives/status` → `contrast`), so the editor's live verdict and the Canvas
 * use the very numbers the publish gate will use (V0 §3.2.1). Read-only: it never generates.
 *
 * `lookup` is what `DesignContext.mediaBounds` expects (sync; `null` = unproven). `stateOf` tells the
 * inspector *why* it is unproven: still `loading`, or `unavailable` (no valid evidence — a picture
 * that predates evidence, a translucent one, or a framed usage that failed).
 *
 * A framed usage that is `processing` — or still `absent` because generation has not started yet (the
 * field waits a debounce before asking for it) — is polled (bounded) until it settles. A usage that
 * a generation/retry in this editor has just made ready is re-read at once (`onUsageGenerated`), so a
 * status fetched before generation never sticks. A stale response never overwrites a newer one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  mediaRefTransform,
  usageNeedsDerivatives,
  usageStatus,
  type UsageContrast,
} from "@/modules/commerce-workspace/storefront-media";
import type { MediaRef } from "../presentation/media-ref";
import type { SectionDesign } from "../presentation/section-design";
import type { MediaBounds } from "../presentation/section-design-resolve";
import { onUsageGenerated, usageKey } from "./use-usage-readiness";

export type BoundsState = "loading" | "ready" | "unavailable";

export interface BackgroundMediaBounds {
  lookup: (ref: MediaRef) => MediaBounds | null;
  stateOf: (ref: MediaRef) => BoundsState;
}

type Entry = { state: BoundsState; bounds: UsageContrast | null };

const POLL_MS = 2000;
const MAX_POLLS = 30;

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
  const signature = refs.map((ref) => usageKey(ref)).join("|");
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const generation = useRef(0);
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    const token = ++generation.current;
    const wanted = new Map<string, MediaRef>();
    for (const ref of refsRef.current) wanted.set(usageKey(ref), ref);
    const cycles = new Map<string, number>();
    let live = true;

    /** One read-and-poll cycle for a usage; a newer cycle for the same usage supersedes it. */
    const read = async (key: string, ref: MediaRef) => {
      const mine = (cycles.get(key) ?? 0) + 1;
      cycles.set(key, mine);
      const current = () => live && token === generation.current && cycles.get(key) === mine;
      for (let attempt = 0; attempt <= MAX_POLLS; attempt += 1) {
        try {
          const status = await usageStatus(ref.mediaId, mediaRefTransform(ref));
          if (!current()) return;
          // `absent` is "not generated yet" only for a framed usage; an unframed picture has no
          // derivative rows by design, so `absent` + no contrast there is final (no evidence).
          const pending =
            status.contrast === null &&
            (status.state === "processing" || (status.state === "absent" && usageNeedsDerivatives(ref)));
          const settled = !pending || attempt === MAX_POLLS;
          setEntries((prev) => ({
            ...prev,
            [key]: status.contrast
              ? { state: "ready", bounds: status.contrast }
              : { state: settled ? "unavailable" : "loading", bounds: null },
          }));
          if (settled) return;
        } catch {
          if (!current()) return;
          setEntries((prev) => ({ ...prev, [key]: { state: "unavailable", bounds: null } }));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!current()) return;
      }
    };

    for (const [key, ref] of wanted) void read(key, ref);
    const stopListening = onUsageGenerated((key) => {
      const ref = wanted.get(key);
      if (ref && live) void read(key, ref);
    });
    return () => {
      live = false;
      stopListening();
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
