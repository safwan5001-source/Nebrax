"use client";

/**
 * CUST-HV V4b — Canvas preview URL for a `MediaRef` (signed workspace URLs).
 *
 * Read-only: it resolves the asset and, for a framed usage, **reads** the
 * derivative status — it never generates (generation is the field's job, on an
 * explicit edit). The framed rendition is used when ready; otherwise the base
 * preview, so the Canvas never shows a broken image while a frame processes.
 * The URL is editor-only, signed and short-lived; it is never written anywhere.
 */
import { useEffect, useState } from "react";
import {
  fetchStorefrontMediaAsset,
  mediaRefTransform,
  usageNeedsDerivatives,
  usageStatus,
} from "@/modules/commerce-workspace/storefront-media";
import type { MediaRef } from "../presentation/media-ref";
import { pickPreviewUrl } from "./use-usage-readiness";

export function useMediaRefPreview(ref: MediaRef | null): string | null {
  const key = ref ? JSON.stringify([ref.mediaId, mediaRefTransform(ref)]) : "";
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!ref) {
      setUrl(null);
      return;
    }
    const controller = new AbortController();
    let live = true;
    (async () => {
      try {
        const asset = await fetchStorefrontMediaAsset(ref.mediaId, controller.signal);
        if (!live) return;
        const base = asset?.previewUrl ?? asset?.thumbnailUrl ?? null;
        setUrl(base);
        if (asset && usageNeedsDerivatives(ref)) {
          const status = await usageStatus(ref.mediaId, mediaRefTransform(ref));
          if (!live) return;
          const framed = status.state === "ready" ? pickPreviewUrl(status) : null;
          if (framed) setUrl(framed);
        }
      } catch {
        if (live) setUrl(null);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the identity of `ref`
  }, [key]);

  return url;
}
