import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/home/SectionHeading";
import { ProductCard } from "@/components/products/ProductCard";
import { ProductCarousel } from "@/components/products/ProductCarousel";
import {
  fetchShelfProducts,
  shelfListingParams,
} from "@/lib/commerce/data-sections";
import {
  type ShelfColumns,
  type ShelfLayout,
  shelfForm,
  shelfGridClass,
  shelfRailBreakpoints,
} from "@/lib/home/shelf-layout";
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
  layout,
  columns,
  hideTitle = false,
}: {
  content: ProductShelfContent;
  basePath: string;
  locale: string;
  currency?: string;
  headingId: string;
  themePreset?: ThemePresetId;
  /** CUST-HV V9d-2 — the section design's `layout` / `columns`; absent = the theme's own form and today's columns. */
  layout?: ShelfLayout;
  columns?: ShelfColumns;
  /** CUST-HV V9d-3 — the merchant hid the title: it stays as the section's accessible name, visually hidden. */
  hideTitle?: boolean;
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
  const rail = shelfForm(layout, themePreset === "awj-market") === "rail";
  const listId = `home_shelf_${headingId}`;

  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        title={title}
        hideTitle={hideTitle}
        action={{ href: `${basePath}/products?${query}`, label: t("viewAll") }}
      />
      {rail ? (
        <div className="mt-4">
          <ProductCarousel
            products={products}
            basePath={basePath}
            currency={currency}
            listId={listId}
            listName={`Home — ${title}`}
            slidesPerView={2}
            breakpoints={shelfRailBreakpoints(columns)}
          />
        </div>
      ) : (
        <ul className={`mt-4 grid gap-3 md:gap-5 ${shelfGridClass(columns)}`}>
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
