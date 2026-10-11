import { getTranslations } from "next-intl/server";
import { ProductCard } from "@/components/products/ProductCard";
import { ProductCarousel } from "@/components/products/ProductCarousel";
import { PRODUCT_CARD_FIELDS } from "@/lib/data/cached";
import { cachedListProducts } from "@/lib/data/products";
import {
  type ShelfColumns,
  type ShelfLayout,
  shelfForm,
  shelfGridClass,
  shelfRailBreakpoints,
} from "@/lib/home/shelf-layout";
import type { ThemePresetId } from "@/lib/presentation/tokens";

interface NewArrivalsProps {
  basePath: string;
  locale: string;
  country: string;
  currency?: string;
  limit?: number;
  /** See `CategoriesSection`'s identical prop doc for why this is explicit. */
  themePreset?: ThemePresetId;
  /** CUST-HV V9d-2 — the section design's `layout` / `columns`; absent = the theme's own form and today's columns. */
  layout?: ShelfLayout;
  columns?: ShelfColumns;
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
  themePreset,
  layout,
  columns,
}: NewArrivalsProps) {
  const rail = shelfForm(layout, themePreset === "awj-market") === "rail";
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

  // AWJ Market's benchmark browses this shelf as a horizontally scrollable
  // rail, not a fixed grid — see the coverage matrix's product-rail evidence.
  // `ProductCarousel` already existed (used nowhere before this) and takes
  // the exact same `Product[]`/`ProductCard` contract this shelf already
  // fetches, so no new data path or component fork is introduced.
  if (rail) {
    return (
      <ProductCarousel
        products={products}
        basePath={basePath}
        currency={currency}
        listId="home_new_arrivals"
        listName="Home — New arrivals"
        slidesPerView={2}
        breakpoints={shelfRailBreakpoints(columns)}
      />
    );
  }

  return (
    <ul className={`grid gap-3 md:gap-5 ${shelfGridClass(columns)}`}>
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
