"use client";

/**
 * AWJ-ANIMATED-MEDIA — Canvas motion preview: where `useMediaRefPreview` leaves the signed URL of an asset's SANITISED animated
 * file for the Canvas pictures to pick up. The preview hook already fetches the asset (it needs `previewUrl`), so publishing the
 * animated URL here costs no second request. Editor-only, in-memory, never written to the document (V0 §6.6): the document keeps
 * the still `MediaRef`; this is the same signed copy the media picker plays on request (`MotionPreview`).
 */
import { useSyncExternalStore } from "react";

const urls = new Map<string, string | null>();
const listeners = new Set<() => void>();

export function setAnimatedPreview(mediaId: string, url: string | null): void {
  if ((urls.get(mediaId) ?? null) === url) return;
  urls.set(mediaId, url);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The signed animated URL of an animated asset, or `null` (static asset, not loaded yet, or no ref). */
export function useAnimatedPreview(mediaId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (mediaId ? (urls.get(mediaId) ?? null) : null),
    () => null,
  );
}
