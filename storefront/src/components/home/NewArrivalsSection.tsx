import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionHeading } from "@/components/home/SectionHeading";
import { NewArrivals } from "@/components/products/NewArrivals";
import { ProductCardSkeleton } from "@/components/products/ProductCardSkeleton";
import {
  type ShelfColumns,
  type ShelfLayout,
  shelfForm,
  shelfGridClass,
} from "@/lib/home/shelf-layout";
import type { ThemePresetId } from "@/lib/presentation/tokens";

const SHELF_SIZE = 8;

function ShelfSkeleton({
  rail,
  columns,
}: {
  rail: boolean;
  columns?: ShelfColumns;
}) {
  if (rail) {
    // Approximates the carousel's own 2/3/5-per-view rhythm (see
    // `NewArrivals.tsx`) so the loading state doesn't jump from a grid to a
    // horizontal rail the instant the real shelf resolves.
    return (
      <div className="flex gap-3 overflow-hidden md:gap-5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => i).map((i) => (
          <div
            key={i}
            className="w-[calc(50%-0.375rem)] shrink-0 sm:w-[calc(33.333%-0.5rem)] lg:w-[calc(20%-1rem)]"
          >
            <ProductCardSkeleton />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ul className={`grid gap-3 md:gap-5 ${shelfGridClass(columns)}`}>
      {Array.from({ length: SHELF_SIZE }, (_, i) => i).map((i) => (
        <li key={i}>
          <ProductCardSkeleton />
        </li>
      ))}
    </ul>
  );
}

interface NewArrivalsSectionProps {
  basePath: string;
  locale: string;
  country: string;
  currency?: string;
  /** See `CategoriesSection`'s identical prop doc for why this is explicit. */
  themePreset?: ThemePresetId;
  /** CUST-HV V9d-2 — the section design's `layout` / `columns`; absent = the theme's own form and today's columns. */
  layout?: ShelfLayout;
  columns?: ShelfColumns;
  /** CUST-HV V9d-3 — the merchant's own title (absent = the translated default) and whether to show it. */
  title?: string;
  hideTitle?: boolean;
}

/**
 * The section frame stays outside the Suspense boundary so the heading and its
 * link are part of the prerendered homepage; only the shelf waits on the
 * catalogue.
 */
export async function NewArrivalsSection({
  basePath,
  locale,
  country,
  currency,
  themePreset,
  layout,
  columns,
  title,
  hideTitle = false,
}: NewArrivalsSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const rail = shelfForm(layout, themePreset === "awj-market") === "rail";

  return (
    <section aria-labelledby="home-new-arrivals">
      <SectionHeading
        id="home-new-arrivals"
        title={title || t("newArrivals")}
        hideTitle={hideTitle}
        action={{ href: `${basePath}/products`, label: t("viewAll") }}
      />
      <div className="mt-3">
        <Suspense fallback={<ShelfSkeleton rail={rail} columns={columns} />}>
          <NewArrivals
            basePath={basePath}
            locale={locale}
            country={country}
            currency={currency}
            limit={SHELF_SIZE}
            themePreset={themePreset}
            layout={layout}
            columns={columns}
          />
        </Suspense>
      </div>
    </section>
  );
}
