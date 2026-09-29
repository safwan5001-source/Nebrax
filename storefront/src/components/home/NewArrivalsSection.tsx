import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionHeading } from "@/components/home/SectionHeading";
import { NewArrivals } from "@/components/products/NewArrivals";
import { ProductCardSkeleton } from "@/components/products/ProductCardSkeleton";
import type { ThemePresetId } from "@/lib/presentation/tokens";

const SHELF_SIZE = 8;

function ShelfSkeleton({ isMarket }: { isMarket: boolean }) {
  if (isMarket) {
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
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:gap-5">
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
}: NewArrivalsSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const isMarket = themePreset === "awj-market";

  return (
    <section aria-labelledby="home-new-arrivals">
      <SectionHeading
        id="home-new-arrivals"
        title={t("newArrivals")}
        action={{ href: `${basePath}/products`, label: t("viewAll") }}
      />
      <div className="mt-3">
        <Suspense fallback={<ShelfSkeleton isMarket={isMarket} />}>
          <NewArrivals
            basePath={basePath}
            locale={locale}
            country={country}
            currency={currency}
            limit={SHELF_SIZE}
            themePreset={themePreset}
          />
        </Suspense>
      </div>
    </section>
  );
}
