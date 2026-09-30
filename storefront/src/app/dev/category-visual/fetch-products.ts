"use server";

import type { PaginatedResponse, Product, ProductListParams } from "@spree/sdk";

/**
 * CUST-H2-5 dev fixture — must be a genuine Server Action (not an inline
 * closure) because `ProductListing` passes it down to the client
 * `InfiniteProductList` island, exactly like the real
 * `c/[...permalink]/page.tsx` does with `getCategoryProducts.bind(null,
 * category.id)`. `locale`/`count` are pre-bound by the page via `.bind()`,
 * leaving `params` as the single arg the client calls with.
 */
export async function fetchFixtureProducts(
  locale: "ar" | "en",
  count: number,
  _params: ProductListParams,
): Promise<PaginatedResponse<Product>> {
  const names =
    locale === "ar"
      ? ["سماعة لاسلكية", "شاحن سريع", "ساعة ذكية", "كاميرا رقمية"]
      : [
          "Wireless Headphones",
          "Fast Charger",
          "Smart Watch",
          "Digital Camera",
        ];

  const data = Array.from({ length: count }).map(
    (_, index) =>
      ({
        id: `product-${index}`,
        name: names[index % names.length],
        slug: `product-${index}`,
        thumbnail_url: null,
        purchasable: true,
        default_variant_id: `variant-${index}`,
        price: {
          display_amount: "٩٩ ر.س",
          amount_in_cents: 9900,
          compare_at_amount_in_cents: null,
          display_compare_at_amount: null,
        },
        original_price: null,
        categories: [],
      }) as unknown as Product,
  );

  return {
    data,
    meta: {
      page: 1,
      limit: 12,
      count: data.length,
      pages: 1,
      from: data.length > 0 ? 1 : 0,
      to: data.length,
      in: data.length,
      previous: null,
    },
  } as unknown as PaginatedResponse<Product>;
}
