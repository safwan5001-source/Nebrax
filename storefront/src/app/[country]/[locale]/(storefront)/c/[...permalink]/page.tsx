import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { ProductListing } from "@/components/products/ProductListing";
import { JsonLd } from "@/components/seo/JsonLd";
import { fetchDeliveryScheduleEnabled } from "@/lib/commerce/data-sections";
import { fetchPublishedPresentation } from "@/lib/commerce/storefront";
import { getCategory, getCategoryProducts } from "@/lib/data/categories";
import { resolveCurrency } from "@/lib/data/markets";
import { getProductFilters } from "@/lib/data/products";
import { generateCategoryMetadata } from "@/lib/metadata/category";
import { publishedPageContainerPaddingClass } from "@/lib/presentation/public-rhythm";
import { buildBreadcrumbJsonLd } from "@/lib/seo";
import { getStoreUrl } from "@/lib/store";
import {
  listingContextParams,
  parseListingContext,
} from "@/lib/utils/listing-context";
import { parseListingSearchParams } from "@/lib/utils/listing-search-params";
import { CategoryBanner } from "./CategoryBanner";

interface CategoryPageProps {
  params: Promise<{
    country: string;
    locale: string;
    permalink: string[];
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { country, locale, permalink } = await params;
  return generateCategoryMetadata({ country, locale, permalink });
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { country, locale, permalink } = await params;
  const rawSearchParams = await searchParams;
  const fullPermalink = permalink.join("/");
  const basePath = `/${country}/${locale}`;

  let category;
  try {
    category = await getCategory(fullPermalink, {
      expand: ["ancestors", "children"],
    });
  } catch (error) {
    console.error("Failed to fetch category:", error);
    notFound();
  }

  if (!category) {
    notFound();
  }

  // CUST-H2-5 — same request-deduped `fetchStorefrontConfig()` call the
  // storefront shell layout already makes for header/footer chrome; this is
  // a cache hit, not a new network round-trip. Published-only, host/tenant
  // resolved server-side — never Draft, never a client-supplied id.
  const presentation = await fetchPublishedPresentation();

  const storeUrl = getStoreUrl();
  const currency = await resolveCurrency(country);
  const listingState = parseListingSearchParams(rawSearchParams);
  // FLOWERS-H10 — gifting filters (facet / brand / deliver today) apply inside
  // a category too; forwarded verbatim next to the category scope.
  const context = parseListingContext(rawSearchParams);

  // Pre-bind categoryId onto the server action so the client-side
  // InfiniteProductList island gets a single-arg (params) fetcher it can
  // call directly. Inline arrow closures don't serialize across the
  // server→client boundary; `.bind()` on a server action reference does.
  const fetchCategoryProducts = getCategoryProducts.bind(null, category.id);

  return (
    <div>
      {storeUrl && (
        <JsonLd data={buildBreadcrumbJsonLd(category, basePath, storeUrl)} />
      )}

      <CategoryBanner
        category={category}
        basePath={basePath}
        locale={locale}
        pagePresentation={presentation?.pagePresentation}
      />

      <StoreContainer
        className={publishedPageContainerPaddingClass(presentation?.density)}
      >
        <ProductListing
          state={listingState}
          basePath={basePath}
          currency={currency}
          locale={locale as Locale}
          listId={`category-${category.id}`}
          listName={`Category: ${category.name}`}
          categoryId={category.id}
          baseParams={{
            in_category: category.id,
            ...listingContextParams(context),
          }}
          fetchProducts={fetchCategoryProducts}
          fetchFilters={getProductFilters}
          fetchDeliverTodayAvailable={fetchDeliveryScheduleEnabled}
        />
      </StoreContainer>
    </div>
  );
}
