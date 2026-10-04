import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/home/SectionHeading";
import { ProductCard } from "@/components/products/ProductCard";
import { ProductCarousel } from "@/components/products/ProductCarousel";
import {
  fetchShelfProducts,
  shelfListingParams,
} from "@/lib/commerce/data-sections";
import type { ProductShelfContent } from "@/lib/presentation/section-content";
import type { ThemePresetId } from "@/lib/presentation/tokens";

/**
 * FLOWERS-H9b / ADR-21 — the published "productShelf" section.
 *
 * The document stores only a *source reference* (collection or facet value)
 * and the deliver-today switch. Products, prices, availability and the
 * deliver-today decision are read live from the public product list, which
 * stays the single authority (publication gate, price resolver, ATS, delivery
 * promise). Nothing resolved is persisted; an unknown/empty source — or a
 * failed read — leaves no section at all (never an empty heading).
 */
export async function ProductShelfSection({
  content,
  basePath,
  locale,
  currency,
  headingId,
  themePreset,
}: {
  content: ProductShelfContent;
  basePath: string;
  locale: string;
  currency?: string;
  headingId: string;
  themePreset?: ThemePresetId;
}) {
  const products = await fetchShelfProducts(content).catch((error) => {
    console.error("ProductShelfSection: failed to load shelf products", error);
    return [];
  });
  if (products.length === 0) return null;

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const title =
    content.title ||
    (content.deliverToday && !content.source
      ? t("deliverToday")
      : t("shopSelection"));
  const query = new URLSearchParams(shelfListingParams(content)).toString();
  const isMarket = themePreset === "awj-market";
  const listId = `home_shelf_${headingId}`;

  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={title}
        action={{ href: `${basePath}/products?${query}`, label: t("viewAll") }}
      />
      {isMarket ? (
        <div className="mt-4">
          <ProductCarousel
            products={products}
            basePath={basePath}
            currency={currency}
            listId={listId}
            listName={`Home — ${title}`}
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
                listId={listId}
                listName={`Home — ${title}`}
                currency={currency}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
