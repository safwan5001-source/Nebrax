import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionHeading } from "@/components/home/SectionHeading";
import { NewArrivals } from "@/components/products/NewArrivals";
import { ProductCardSkeleton } from "@/components/products/ProductCardSkeleton";
import type { ThemePresetId } from "@/lib/presentation/tokens";
import { cn } from "@/lib/utils";

const SHELF_SIZE = 8;

function ShelfSkeleton({ isMarket }: { isMarket: boolean }) {
  return (
    <ul
      className={cn(
        "grid gap-3 md:gap-5",
        isMarket
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
      )}
    >
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
