import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildHreflangLanguages } from "@/lib/metadata/alternates";
import { buildCanonicalUrl } from "@/lib/seo";
import { getStoreUrl } from "@/lib/store";

interface CategoriesMetadataParams {
  country: string;
  locale: string;
}

export async function generateCategoriesMetadata({
  country,
  locale,
}: CategoriesMetadataParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "products",
  });
  const title = t("categories");
  const description = t("browseCollection");
  const storeUrl = getStoreUrl();
  const canonicalUrl = storeUrl
    ? buildCanonicalUrl(storeUrl, `/${country}/${locale}/c`)
    : undefined;
  const languages = storeUrl
    ? await buildHreflangLanguages({
        storeUrl,
        country,
        locale,
        path: "/c",
      })
    : undefined;

  return {
    title,
    description,
    ...(canonicalUrl
      ? {
          alternates: {
            canonical: canonicalUrl,
            ...(languages ? { languages } : {}),
          },
        }
      : {}),
    openGraph: {
      title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      type: "website",
    },
  };
}
