import { getTranslations } from "next-intl/server";
import { ProductCard } from "@/components/products/ProductCard";
import { PRODUCT_CARD_FIELDS } from "@/lib/data/cached";
import { cachedListProducts } from "@/lib/data/products";

interface NewArrivalsProps {
  basePath: string;
  locale: string;
  country: string;
  currency?: string;
  limit?: number;
}

/**
 * The homepage product shelf.
 *
 * Ordered by `-available_on`, which the adapter maps to the catalogue's
 * `created_at` — one of the three sorts `StorefrontProductController` actually
 * allows. That is why this shelf is titled "new arrivals" and not "featured" or
 * "best selling": AWJ exposes no featuring, ranking or sales-volume signal, so
 * either of those headings would be a claim invented by the storefront. The
 * previous section carried the "featured" title over an unsorted page of the
 * catalogue, which was alphabetical in practice.
 */
export async function NewArrivals({
  basePath,
  locale,
  country,
  currency,
  limit = 8,
}: NewArrivalsProps) {
  const products = await cachedListProducts(
    { limit, sort: "-available_on", fields: PRODUCT_CARD_FIELDS },
    { locale, country },
    "dtc",
  )
    .then((res) => res.data ?? [])
    .catch((error) => {
      console.error("NewArrivals: failed to load products", error);
      return [];
    });

  if (products.length === 0) {
    const t = await getTranslations({
      locale: locale as Locale,
      namespace: "products",
    });
    return (
      <div className="rounded-store border border-dashed border-store-border px-6 py-14 text-center">
        <p className="text-base font-semibold text-store-foreground">
          {t("noProductsFound")}
        </p>
        <p className="mt-1 text-sm text-store-muted-foreground">
          {t("browseCollection")}
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:gap-5">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            basePath={basePath}
            index={index}
            listId="home_new_arrivals"
            listName="Home — New arrivals"
            currency={currency}
            fetchPriority={index < 4 ? "high" : "auto"}
          />
        </li>
      ))}
    </ul>
  );
}
