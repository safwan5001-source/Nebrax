import { ProductCard } from "@/components/products/ProductCard";
import { fetchProduct } from "@/lib/commerce/products";

export async function FeaturedShelf({
  productIds,
  basePath,
  locale,
  currency,
  title,
}: {
  productIds: readonly string[];
  basePath: string;
  locale: string;
  currency?: string;
  title: string;
}) {
  const settled = await Promise.allSettled(
    productIds.map((id) => fetchProduct(id)),
  );
  const products = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (products.length === 0) return null;

  return (
    <section aria-labelledby="home-featured">
      <h2
        id="home-featured"
        className="text-base font-extrabold text-store-foreground md:text-lg"
      >
        {title}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:gap-5">
        {products.map((product, index) => (
          <li key={product.id}>
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
    </section>
  );
}
