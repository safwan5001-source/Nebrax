import type {
  PaginatedResponse,
  PaginationMeta,
  Product,
  ProductFiltersResponse,
  ProductListParams,
} from "@spree/sdk";
import { getLocaleOptions } from "@/lib/spree";
import { storefrontFetch } from "./config";
import { mapAwjProductToViewModel } from "./mappers";
import type { AwjListResponse, AwjProduct, AwjResourceResponse } from "./types";

/**
 * Sort id translation: Spree's UI/components speak Spree's sort ids
 * (`price` / `-price` / `name` / `-name` / ...); the AWJ storefront API
 * speaks its own allow-listed columns (`sale_price` / `name` /
 * `created_at`, see `StorefrontProductController::SORTS`). Unknown/
 * unsupported ids fall back to the AWJ API's own default (`name`).
 */
const SORT_TO_AWJ: Record<string, string> = {
  price: "sale_price",
  "-price": "-sale_price",
  name: "name",
  "-name": "-name",
  available_on: "created_at",
  "-available_on": "-created_at",
};

function mapSort(sort: string | undefined): string | undefined {
  if (!sort) return undefined;
  return SORT_TO_AWJ[sort];
}

function buildPaginationMeta(
  pagination: {
    page: number;
    per_page: number;
    total: number;
    last_page: number;
    has_more: boolean;
  },
  itemCount: number,
): PaginationMeta {
  const from =
    itemCount > 0 ? (pagination.page - 1) * pagination.per_page + 1 : 0;
  const to = itemCount > 0 ? from + itemCount - 1 : 0;

  return {
    page: pagination.page,
    limit: pagination.per_page,
    count: pagination.total,
    pages: pagination.last_page,
    from,
    to,
    in: itemCount,
    previous: pagination.page > 1 ? pagination.page - 1 : null,
    next: pagination.has_more ? pagination.page + 1 : null,
  };
}

export async function fetchProducts(
  params: ProductListParams | undefined,
): Promise<PaginatedResponse<Product>> {
  const response = await storefrontFetch<AwjListResponse<AwjProduct>>(
    "products",
    {
      page: params?.page,
      per_page: params?.limit,
      search: params?.search,
      category_id: params?.in_category,
      sort: mapSort(params?.sort),
    },
  );

  const { locale } = await getLocaleOptions();
  const data = response.data.map((product) =>
    mapAwjProductToViewModel(product, locale),
  );

  return {
    data,
    meta: buildPaginationMeta(response.meta.pagination, data.length),
  };
}

export async function fetchProduct(idOrSlug: string): Promise<Product> {
  const response = await storefrontFetch<AwjResourceResponse<AwjProduct>>(
    `products/${idOrSlug}`,
  );
  const { locale } = await getLocaleOptions();

  return mapAwjProductToViewModel(response.data, locale);
}

/**
 * AWJ has no faceted search (no product-variant/option-value model to
 * facet on — see AWJ_SPREE_TECHNICAL_FIT_AUDIT.md §4) and the AWJ catalog
 * API does not understand Spree's Ransack (`q[...]`) query shape that
 * `ProductListing`'s facet fetch wraps its params in. This returns an
 * empty facet list with a sort menu matching the AWJ API's actual sort
 * support; `ListingFilterBar` already renders a bare filter bar (no
 * facets) when the facet fetch is empty/fails, so this is not a stub
 * masquerading as a real feature — it is what the current AWJ catalog
 * contract supports. `_params` is accepted only to match the existing
 * `fetchFilters` call signature `ProductListing` expects.
 */
export async function fetchProductFilters(
  _params?: Record<string, unknown>,
): Promise<ProductFiltersResponse> {
  return {
    filters: [],
    sort_options: [
      { id: "name" },
      { id: "-name" },
      { id: "price" },
      { id: "-price" },
    ],
    default_sort: "name",
    total_count: 0,
  };
}
