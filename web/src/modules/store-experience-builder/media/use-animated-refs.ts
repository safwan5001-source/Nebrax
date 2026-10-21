"use client";

/**
 * P3-A-06 — whether any of these pictures is an animated asset. The global background is still-only and an animation
 * has no pixel evidence, so the editor says "choose a still image" instead of a misleading "overlay too weak". Reads the
 * library asset through the existing endpoint (never generates); unknown (loading / failed) is reported as `false` — the
 * server still refuses an animated asset at publish with `global_media_animated_unsupported`.
 */
import { useEffect, useState } from "react";
import { fetchStorefrontMediaAsset } from "@/modules/commerce-workspace/storefront-media";
import type { MediaRef } from "../presentation/media-ref";

export function useAnyAnimated(refs: ReadonlyArray<MediaRef>): boolean {
  const ids = Array.from(new Set(refs.map((ref) => ref.mediaId))).sort();
  const signature = ids.join("|");
  const [animated, setAnimated] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const controller = new AbortController();
    for (const id of ids) {
      fetchStorefrontMediaAsset(id, controller.signal)
        .then((asset) => {
          if (!controller.signal.aborted) setAnimated((prev) => ({ ...prev, [id]: Boolean(asset?.animation) }));
        })
        .catch(() => {});
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` is the identity of `ids`
  }, [signature]);

  return ids.some((id) => animated[id] === true);
}
