import type {
  StorefrontMediaAsset,
  StorefrontMediaPage,
  UsageStatus,
} from "@/modules/commerce-workspace/storefront-media";

export const MEDIA_ID = "0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b";
export const MEDIA_ID_2 = "7c1d3e4f-5a6b-4c8d-9e0f-1a2b3c4d5e6f";

export function asset(over: Partial<StorefrontMediaAsset> = {}): StorefrontMediaAsset {
  return {
    id: MEDIA_ID,
    name: "storefront-hero.jpg",
    mime: "image/jpeg",
    size: 120_000,
    width: 4000,
    height: 3000,
    altAr: null,
    altEn: null,
    variantsState: "ready",
    variantsError: null,
    thumbnailUrl: "https://signed.example/thumb.webp",
    previewUrl: "https://signed.example/preview.webp",
    usageCount: null,
    ...over,
  };
}

export function page(
  items: StorefrontMediaAsset[],
  over: Partial<StorefrontMediaPage["meta"]> = {},
): StorefrontMediaPage {
  return {
    items,
    meta: {
      nextCursor: null,
      hasMore: false,
      uploadsEnabled: true,
      maxFilesPerRequest: 5,
      maxBytes: 20_000_000,
      library: { assets: items.length, maxAssets: 500, bytes: 0, maxBytes: 1_000_000_000 },
      ...over,
    },
  };
}

export function usage(over: Partial<UsageStatus> = {}): UsageStatus {
  return {
    mediaId: MEDIA_ID,
    usageKey: "k",
    state: "ready",
    retryable: false,
    errorCode: null,
    files: [
      { width: 768, format: "webp", state: "ready", url: "https://signed.example/f768.webp", renderedWidth: 768, renderedHeight: 432 },
    ],
    contrast: null,
    ...over,
  };
}
