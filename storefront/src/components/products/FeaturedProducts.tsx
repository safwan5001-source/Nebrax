import dynamic from "next/dynamic";
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
  // A catalog outage (e.g. the visitor's hostname has no active
  // StorefrontDomain mapping yet — fail-closed by design, see
  // ResolveStorefrontDomain) must degrade this section, not crash the whole
  // homepage. Mirrors the existing defensive pattern already used for
  // category navigation in StorefrontLayout's getRootCategories.
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

  return (
    <LazyProductCarousel
      products={products}
      basePath={basePath}
      currency={currency}
    />
  );
}
