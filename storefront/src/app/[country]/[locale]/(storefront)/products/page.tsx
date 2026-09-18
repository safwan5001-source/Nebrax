import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { ProductListing } from "@/components/products/ProductListing";
import { resolveCurrency } from "@/lib/data/markets";
import { getProductFilters, getProducts } from "@/lib/data/products";
import { generateProductsMetadata } from "@/lib/metadata/products";
import { parseListingSearchParams } from "@/lib/utils/listing-search-params";

interface ProductsPageProps {
  params: Promise<{
    country: string;
    locale: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: ProductsPageProps): Promise<Metadata> {
  const { country, locale } = await params;
  return generateProductsMetadata({ country, locale });
}

export default async function ProductsPage({
  params,
  searchParams,
}: ProductsPageProps) {
  const { country, locale } = await params;
  const rawSearchParams = await searchParams;
  const basePath = `/${country}/${locale}`;
  const currency = await resolveCurrency(country);

  const listingState = parseListingSearchParams(rawSearchParams);
  const query = listingState.query;

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "products",
  });

  const listId = query ? "search-results" : "all-products";
  const listName = query ? "Search Results" : "All Products";

  return (
    // One measure and one rhythm, the same `StoreContainer` the shell and the
    // homepage align to — this page used its own `container mx-auto` and raw
    // gray-500/900 text, so it sat on a different grid to everything around it.
    <StoreContainer className="space-y-5 py-5 md:space-y-6 md:py-6">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary md:mt-1.5 md:h-5"
        />
        <div className="min-w-0">
          <h1 className="text-base font-extrabold leading-tight text-store-foreground md:text-lg">
            {query ? t("searchResultsFor", { query }) : t("allProducts")}
          </h1>
          {!query && (
            <p className="mt-0.5 hidden text-xs text-store-muted-foreground md:block">
              {t("browseCollection")}
            </p>
          )}
        </div>
      </div>

      <ProductListing
        state={listingState}
        basePath={basePath}
        currency={currency}
        locale={locale as Locale}
        listId={listId}
        listName={listName}
        fetchProducts={getProducts}
        fetchFilters={getProductFilters}
        emptyMessage={
          query ? t("noMatchingProducts", { query }) : t("tryAdjustingFilters")
        }
      />
    </StoreContainer>
  );
}
