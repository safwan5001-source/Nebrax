import type { Metadata } from "next";
import { resolveStoreTitleName } from "@/lib/metadata/store-identity";
import { SOCIAL_IMAGE_PATH } from "@/lib/seo";
import { getStoreUrl } from "@/lib/store";

function normalizeOpenGraphLocale(locale: string): string {
  const parts = locale.split(/[-_]/);
  if (parts.length < 2) return locale;
  return `${parts[0].toLowerCase()}_${parts[1].toUpperCase()}`;
}

interface StoreMetadataParams {
  locale: string;
}

export async function generateStoreMetadata({
  locale,
}: StoreMetadataParams): Promise<Metadata> {
  const storeName = await resolveStoreTitleName(locale);
  const storeUrl = getStoreUrl();
  const metaDescription = process.env.STORE_META_DESCRIPTION;
  const metaKeywords = process.env.STORE_META_KEYWORDS;
  const twitter = process.env.STORE_TWITTER;
  let metadataBaseSpread: Partial<{ metadataBase: URL }> = {};
  if (storeUrl) {
    try {
      metadataBaseSpread = { metadataBase: new URL(storeUrl) };
    } catch {
      metadataBaseSpread = {};
    }
  }

  return {
    ...metadataBaseSpread,
    title: {
      template: `%s | ${storeName}`,
      default: storeName,
    },
    ...(metaDescription ? { description: metaDescription } : {}),
    icons: {
      icon: "/icon",
      apple: "/icon",
    },
    ...(metaKeywords ? { keywords: metaKeywords } : {}),
    openGraph: {
      siteName: storeName,
      locale: normalizeOpenGraphLocale(locale),
      type: "website",
      images: [SOCIAL_IMAGE_PATH],
    },
    twitter: {
      card: "summary_large_image",
      ...(twitter
        ? {
            site: twitter.startsWith("@") ? twitter : `@${twitter}`,
          }
        : {}),
    },
  };
}
