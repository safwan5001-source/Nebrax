import type {
  PaginatedResponse,
  Product,
  ProductFiltersResponse,
} from "@spree/sdk";
import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type ReactElement, Suspense } from "react";
import { GiftingFilters } from "@/components/products/GiftingFilters";
import { InfiniteProductList } from "@/components/products/InfiniteProductList";
import { ListingAnalytics } from "@/components/products/ListingAnalytics";
import { ListingFilterBar } from "@/components/products/ListingFilterBar";
import { ProductListingSkeleton } from "@/components/products/ProductListingSkeleton";
import {
  EMPTY_LISTING_FACETS,
  type ListingFacets,
} from "@/lib/commerce/listing-facets";
import { PRODUCT_CARD_FIELDS } from "@/lib/data/cached";
import type { StorefrontListParams } from "@/lib/utils/listing-context";
import {
  type ListingSearchParams,
  listingKey,
} from "@/lib/utils/listing-search-params";
import {
  buildProductQueryParams,
  wrapInRansackParams,
} from "@/lib/utils/product-query";

const PAGE_SIZE = 12;

interface ProductListingProps {
  state: ListingSearchParams;
  basePath: string;
  currency?: string;
  locale: Locale;
  listId: string;
  listName: string;
  categoryId?: string;
  /** Extra params always merged into the products list fetch (e.g. in_category). */
  baseParams?: StorefrontListParams;
  /**
   * Server action fetching a page of products. Must be a server action
   * reference (not an inline closure) so it can be passed to the client
   * InfiniteProductList island for subsequent load-more calls.
   */
  fetchProducts: (
    params: StorefrontListParams,
  ) => Promise<PaginatedResponse<Product>>;
  /** Fetcher for the facet data (filters + sort options). Server-only. */
  fetchFilters: (
    params: Record<string, unknown>,
  ) => Promise<ProductFiltersResponse>;
  /** Shown when the fetch returns zero results. */
  emptyMessage?: string;
  /**
   * Resolves whether the store offers delivery scheduling, which gates the
   * gifting "Deliver today" filter. Read inside the Suspense boundary, in
   * parallel with the product fetch; omitted → the filter is not offered.
   */
  fetchDeliverTodayAvailable?: () => Promise<boolean>;
}

/**
 * Server-rendered product listing. Fetches products + facet data in
 * parallel inside a Suspense boundary so the surrounding shell (header,
 * breadcrumbs, banner) can stream immediately.
 *
 * Filter / sort / query state lives in the URL via ListingSearchParams.
 * Click handlers in the filter bar write to the URL with router.push
 * inside a startTransition, which triggers a soft navigation and
 * re-runs this server component.
 *
 * The Suspense boundary is intentionally NOT keyed on listing state.
 * On first load the fallback shows the skeleton, but on subsequent
 * filter / sort / query changes useTransition keeps the previous tree
 * visible while the new server render resolves — the filter bar and
 * grid then swap atomically, without flashing a skeleton in between.
 *
 * Pagination uses infinite scroll: the server renders page 1, and
 * the client InfiniteProductList island fetches subsequent pages via
 * the same server action on scroll. The island is keyed on the full
 * listing state so every filter / sort / query change remounts it
 * with the new server-provided page 1, atomically replacing the old
 * grid without any loading fallback being shown.
 */
export function ProductListing(props: ProductListingProps): ReactElement {
  return (
    <Suspense fallback={<ProductListingSkeleton />}>
      <ProductListingInner {...props} />
    </Suspense>
  );
}

async function ProductListingInner({
  state,
  basePath,
  currency,
  locale,
  listId,
  listName,
  categoryId,
  baseParams,
  fetchProducts,
  fetchFilters,
  emptyMessage,
  fetchDeliverTodayAvailable,
}: ProductListingProps): Promise<ReactElement> {
  const t = await getTranslations({ locale, namespace: "products" });

  const queryParams = buildProductQueryParams(state.filters, state.query);

  // Base SDK list params for the current filter/sort/query state.
  // The client island reuses this when fetching subsequent pages.
  //
  // `fields` is applied LAST so neither `queryParams` nor `baseParams`
  // can accidentally override the narrowed card-fields set. This
  // restricts the payload to what <ProductCard> and listing analytics
  // actually read — shrinking the cached entry, the RSC→client
  // serialization, and the streaming HTML.
  const listParams: StorefrontListParams = {
    limit: PAGE_SIZE,
    ...queryParams,
    ...baseParams,
    fields: PRODUCT_CARD_FIELDS,
  };

  // Filters fetch: Ransack-wrapped with the same active filter
  // context, so facet counts reflect the user's current selection.
  // Sort is stripped because facet counts are independent of sort
  // order — keeping it in the args would bust the cache on every
  // sort change for no functional reason.
  const { sort: _sort, ...filterQueryParams } = queryParams;
  const filterFetchParams = wrapInRansackParams({
    ...filterQueryParams,
    ...baseParams,
  });

  // Products fetch intentionally un-caught: a failure here is a real
  // error (backend down, bad params) and should bubble to the route
  // error boundary rather than masquerade as a legitimate empty
  // results page. Filters fetch is cosmetic (facet counts) so we fall
  // back to a bare filter bar on failure.
  const [productsResponse, filtersResponse, deliverTodayAvailable] =
    await Promise.all([
      fetchProducts({ ...listParams, page: 1 }),
      fetchFilters(filterFetchParams).catch((error) => {
        console.error("ProductListing: filters fetch failed", error);
        return null;
      }),
      fetchDeliverTodayAvailable
        ? fetchDeliverTodayAvailable().catch(() => false)
        : Promise.resolve(false),
    ]);

  const products = productsResponse.data;
  const totalCount = productsResponse.meta.count;
  const totalPages = productsResponse.meta.pages;

  const hasResults = products.length > 0;
  // Facet / brand counts ride on page 1's meta (FLOWERS-H10); other listing
  // surfaces whose fetcher does not provide them simply render no group.
  const listingFacets: ListingFacets =
    (productsResponse.meta as { listingFacets?: ListingFacets })
      .listingFacets ?? EMPTY_LISTING_FACETS;
  // Catalog context (collection / facet / brand / deliver-today) is part of
  // the listing identity: the island remount AND the analytics de-dupe key
  // must both change when only the context does (e.g. "show all products").
  const contextKey = `${listingKey(state)}|${JSON.stringify(baseParams ?? {})}`;

  return (
    <>
      <GiftingFilters
        facets={listingFacets}
        deliverTodayAvailable={deliverTodayAvailable}
      />
      <ListingFilterBar
        filtersData={filtersResponse}
        activeFilters={state.filters}
        totalCount={totalCount}
      />

      {hasResults ? (
        <>
          <InfiniteProductList
            // Remount on any filter / sort / query change so the
            // island picks up the new initialProducts and resets its
            // accumulated scroll state. The swap is atomic — because
            // the surrounding Suspense boundary isn't keyed and the
            // new instance mounts with products already populated,
            // the user sees the grid update in place with no loading
            // fallback shown.
            key={contextKey}
            initialProducts={products}
            initialPage={1}
            totalPages={totalPages}
            listParams={listParams}
            fetchPage={fetchProducts}
            basePath={basePath}
            categoryId={categoryId}
            listId={listId}
            listName={listName}
            currency={currency}
          />
          <ListingAnalytics
            products={products}
            listId={listId}
            listName={listName}
            query={state.query}
            currency={currency}
            stateKey={contextKey}
          />
        </>
      ) : (
        <div className="text-center py-12">
          <Search
            className="mx-auto h-12 w-12 text-gray-400"
            strokeWidth={1.5}
          />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {t("noProductsFound")}
          </h3>
          <p className="mt-2 text-gray-500">
            {emptyMessage ?? t("tryAdjustingFilters")}
          </p>
        </div>
      )}
    </>
  );
}
