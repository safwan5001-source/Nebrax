import { ProductCard } from "@/components/products/ProductCard";
import { ProductCarousel } from "@/components/products/ProductCarousel";
import { fetchProduct } from "@/lib/commerce/products";
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
  const settled = await Promise.allSettled(
    productIds.map((id) => fetchProduct(id)),
  );
  const products = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
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
