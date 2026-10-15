'use client';

/**
 * AWJ-VD-H1 / VD-3 — where the editor's preview gets the picture of the identity being edited.
 *
 * Two sources, in this order:
 * 1. **The signed `visual_preview` thumbnail the list endpoint returned** for the image already stored. It needs no
 *    library read, so a role without `commerce.manage` previews with it (D-04) — and so does everyone else while the
 *    stored image is unchanged.
 * 2. **The library asset**, only for an image picked in this session (not stored yet) and only for a role that may read
 *    the library. Its answer also tells «deleted» from «still processing» from «ready».
 *
 * Every non-ready outcome is a named state, never a broken `<img>`: the tile falls back to the icon, then the name
 * (D-08) and the editor says why in words. A thumbnail that fails to load flips the state to `failed`.
 */

import { useEffect, useState } from 'react';
import { fetchStorefrontMediaAsset } from '@/modules/commerce-workspace/storefront-media';
import type { FacetVisualTileImage } from '@/modules/store-experience-builder/FacetVisualTile';
import { type FacetVisualPreview, safePreviewUrl } from '../client';

export type ImageState = 'none' | 'loading' | 'ready' | 'not_ready' | 'deleted' | 'failed' | 'unavailable';

export interface ImageSource {
  state: ImageState;
  image: FacetVisualTileImage | null;
}

/** Tile image of a stored preview (the 160 and 320 px variants as a `srcset`). */
export function previewImage(preview: FacetVisualPreview | null | undefined): FacetVisualTileImage | null {
  if (!preview) return null;
  // Re-checked here as well: this is where the URL becomes an image source.
  const thumb160 = safePreviewUrl(preview.thumb160);
  const thumb320 = safePreviewUrl(preview.thumb320);
  const src = thumb320 ?? thumb160;
  if (!src) return null;
  const set = [thumb160 ? `${thumb160} 160w` : null, thumb320 ? `${thumb320} 320w` : null].filter(Boolean);
  return { src, ...(set.length > 1 ? { srcSet: set.join(', ') } : {}) };
}

type Library =
  | { mediaId: string; state: 'not_ready' | 'deleted' | 'unavailable' }
  | { mediaId: string; state: 'ready'; src: string };

export function useFacetImageSource({
  mediaId,
  storedMediaId,
  storedPreview,
  canReadLibrary,
}: {
  mediaId: string | null;
  storedMediaId: string | null;
  storedPreview: FacetVisualPreview | null;
  canReadLibrary: boolean;
}): ImageSource {
  const stored = mediaId !== null && mediaId === storedMediaId ? previewImage(storedPreview) : null;
  const [library, setLibrary] = useState<Library | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // The library answers only when there is no stored thumbnail for this image and the role may read the library.
  useEffect(() => {
    if (!mediaId || stored || !canReadLibrary) {
      setLibrary(null);
      return;
    }
    const controller = new AbortController();
    setLibrary(null);
    fetchStorefrontMediaAsset(mediaId, controller.signal)
      .then((asset) => {
        if (controller.signal.aborted) return;
        if (!asset) setLibrary({ mediaId, state: 'deleted' });
        else if (asset.variantsState !== 'ready') setLibrary({ mediaId, state: 'not_ready' });
        else {
          const src = asset.previewUrl ?? asset.thumbnailUrl;
          setLibrary(src ? { mediaId, state: 'ready', src } : { mediaId, state: 'unavailable' });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLibrary({ mediaId, state: 'unavailable' });
      });
    return () => controller.abort();
    // `stored` is derived from the two stored inputs below, so those are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, storedMediaId, storedPreview, canReadLibrary]);

  const image: FacetVisualTileImage | null =
    stored ?? (library && library.mediaId === mediaId && library.state === 'ready' ? { src: library.src } : null);

  // A thumbnail that cannot be loaded (an expired signature, a network error) is reported, not left broken.
  const src = image?.src ?? null;
  useEffect(() => {
    if (!src || typeof Image === 'undefined') return;
    const probe = new Image();
    probe.onerror = () => setFailedSrc(src);
    probe.src = src;
    return () => {
      probe.onerror = null;
    };
  }, [src]);

  if (!mediaId) return { state: 'none', image: null };
  if (image) return failedSrc === image.src ? { state: 'failed', image: null } : { state: 'ready', image };
  if (!canReadLibrary) return { state: 'unavailable', image: null };
  if (!library || library.mediaId !== mediaId) return { state: 'loading', image: null };
  return { state: library.state === 'ready' ? 'ready' : library.state, image: null };
}
