import { ProductCard } from "@/components/products/ProductCard";
import { ProductCarousel } from "@/components/products/ProductCarousel";
import { fetchProductsByIds } from "@/lib/commerce/products";
import type { ThemePresetId } from "@/lib/presentation/tokens";

export async function FeaturedShelf({
  productIds,
  basePath,
  locale,
  currency,
  title,
  headingId,
  themePreset,
}: {
  productIds: readonly string[];
  basePath: string;
  locale: string;
  currency?: string;
  title: string;
  headingId: string;
  /** See `CategoriesSection`'s identical prop doc for why this is explicit. */
  themePreset?: ThemePresetId;
}) {
  const isMarket = themePreset === "awj-market";
  // CUST-H4-5 — one batched request instead of N per-id fetches. The API
  // may answer in any order, so the merchant's stored `productIds` order is
  // restored here — that array is presentation's own authority over display
  // order (see the architecture contract's "Order semantics"), never the
  // database's. A product id that failed to resolve (foreign, unpublished,
  // deleted) is simply missing from `byId` and dropped by `.filter()` below
  // — the same fail-closed, no-fabricated-fallback behavior the previous
  // per-id `Promise.allSettled` loop already had.
  const resolved = await fetchProductsByIds(productIds).catch((error) => {
    console.error("FeaturedShelf: failed to load featured products", error);
    return [];
  });
  const byId = new Map(resolved.map((product) => [product.id, product]));
  const products = productIds
    .map((id) => byId.get(id))
    .filter(
      (product): product is NonNullable<typeof product> =>
        product !== undefined,
    );
  if (products.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-base font-extrabold text-store-foreground md:text-lg"
      >
        {title}
      </h2>
      {isMarket ? (
        <div className="mt-4">
          <ProductCarousel
            products={products}
            basePath={basePath}
            currency={currency}
            listId="home_featured"
            listName="Home — Featured"
            slidesPerView={2}
            breakpoints={{
              640: { slidesPerView: 3, spaceBetween: 16 },
              1024: { slidesPerView: 5, spaceBetween: 20 },
            }}
          />
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:gap-5">
          {products.map((product, index) => (
            <li key={product.id} className="min-w-0">
              <ProductCard
                product={product}
                basePath={basePath}
                index={index}
                listId="home_featured"
                listName="Home — Featured"
                currency={currency}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
