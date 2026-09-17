import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SectionHeading } from "@/components/home/SectionHeading";
import { NewArrivals } from "@/components/products/NewArrivals";
import { ProductCardSkeleton } from "@/components/products/ProductCardSkeleton";

const SHELF_SIZE = 8;

function ShelfSkeleton() {
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
}: NewArrivalsSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });

  return (
    <section aria-labelledby="home-new-arrivals">
      <SectionHeading
        id="home-new-arrivals"
        title={t("newArrivals")}
        action={{ href: `${basePath}/products`, label: t("viewAll") }}
      />
      <div className="mt-3">
        <Suspense fallback={<ShelfSkeleton />}>
          <NewArrivals
            basePath={basePath}
            locale={locale}
            country={country}
            currency={currency}
            limit={SHELF_SIZE}
          />
        </Suspense>
      </div>
    </section>
  );
}
