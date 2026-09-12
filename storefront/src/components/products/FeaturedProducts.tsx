import dynamic from "next/dynamic";
import { getTranslations } from "next-intl/server";
import { ProductCardSkeleton } from "@/components/products/ProductCardSkeleton";
import { PRODUCT_CARD_FIELDS } from "@/lib/data/cached";
import { cachedListProducts } from "@/lib/data/products";
import { getAccessToken } from "@/lib/spree";

const LazyProductCarousel = dynamic(
  () =>
    import("@/components/products/ProductCarousel").then((mod) => ({
      default: mod.ProductCarousel,
    })),
  {
    loading: () => (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    ),
  },
);

interface FeaturedProductsProps {
  basePath: string;
  locale: string;
  country: string;
  currency?: string;
}

export async function FeaturedProducts({
  basePath,
  locale,
  country,
  currency,
}: FeaturedProductsProps) {
  const userToken = await getAccessToken();
  const products = await cachedListProducts(
    { limit: 8, fields: PRODUCT_CARD_FIELDS },
    { locale, country },
    "dtc",
    userToken,
  )
    .then((res) => res.data ?? [])
    .catch((error) => {
      console.error("FeaturedProducts: failed to load products", error);
      return [];
    });

  if (products.length === 0) {
    const t = await getTranslations({
      locale: locale as Locale,
      namespace: "products",
    });
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-6 py-16 text-center">
        <p className="text-base font-medium text-gray-900">
          {t("noProductsFound")}
        </p>
        <p className="mt-2 text-sm text-gray-500">{t("browseCollection")}</p>
      </div>
    );
  }

  return (
    <LazyProductCarousel
      products={products}
      basePath={basePath}
      currency={currency}
    />
  );
}
