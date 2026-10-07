import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ThemePresetId } from "@/lib/presentation/tokens";
import { cn } from "@/lib/utils";

interface HeroSectionProps {
  basePath: string;
  locale: string;
  storeName: string | null;
  /**
   * Merchant-configured hero copy from the published presentation
   * (`homepage.heroHeadline` / `homepage.heroSubheadline`); the Home page
   * passes both. An empty headline falls back to the store name; an empty
   * subheadline renders nothing. Only this copy is configurable today — image,
   * overlay, CTA and per-instance design belong to CUST-HV V6.
   */
  headline?: string | null;
  subheadline?: string | null;
  /** See `CategoriesSection`'s identical prop doc for why this is explicit. */
  themePreset?: ThemePresetId;
  /** A section design frame wraps the hero: expose the content-box marker its rules address. */
  designed?: boolean;
}

/**
 * The storefront masthead.
 *
 * It states who the store is and offers one way into the catalogue, and that is
 * all it claims. The live storefront contract carries a name and a default
 * locale, and the merchant's published presentation adds a headline and a
 * subheadline — no banner image, no campaign — so there is nothing else here
 * that would be true.
 *
 * With no merchant image to place, the band is deliberately plain: the store's
 * name set large on the approved palette, one CTA, and nothing else. An earlier
 * pass filled the empty side with an oversized translucent initial; that read
 * as placeholder decoration and was removed rather than replaced, because
 * anything put there — a monogram, an illustration, a stock photograph — would
 * be storefront invention standing in for merchant content. The band is not
 * made taller to compensate for the space it no longer fills.
 *
 * AWJ Market shrinks it further still: the benchmark's high-SKU retail
 * composition puts category/product discovery first and treats the masthead
 * as a brief identity strip, not a destination — see the coverage matrix.
 * Nothing about *what* the band says changes, only how much vertical space it
 * claims before the categories/products below it appear.
 */
export async function HeroSection({
  basePath,
  locale,
  storeName,
  headline,
  subheadline,
  themePreset,
  designed = false,
}: HeroSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const footer = await getTranslations({
    locale: locale as Locale,
    namespace: "footer",
  });
  const displayName = storeName?.trim() || footer("shop");
  const title = headline?.trim() || displayName;
  const isMarket = themePreset === "awj-market";

  return (
    <section
      aria-labelledby="home-hero"
      className={cn(
        "flex items-center rounded-store bg-linear-to-r rtl:bg-linear-to-l from-primary-700 via-primary-600 to-primary-500 text-store-primary-foreground",
        isMarket
          ? "min-h-[7rem] md:min-h-[9rem] lg:min-h-[10rem]"
          : "min-h-[11rem] md:min-h-[16rem] lg:min-h-[18rem]",
      )}
    >
      <div
        data-section-content={designed ? "" : undefined}
        className={cn(
          "max-w-2xl",
          isMarket ? "p-4 md:p-6 lg:p-8" : "p-5 md:p-10 lg:p-14",
        )}
      >
        <h1
          id="home-hero"
          className="text-xl font-black leading-tight sm:text-2xl lg:text-4xl"
        >
          <bdi>{title}</bdi>
        </h1>
        {subheadline?.trim() && (
          <p className="mt-2 line-clamp-2 text-xs text-store-primary-foreground/80 md:mt-3 md:text-sm">
            {subheadline}
          </p>
        )}
        <Link
          href={`${basePath}/products`}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-store bg-store-primary-foreground px-4 text-xs font-bold text-store-primary shadow-md transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary-foreground md:mt-5 md:h-11 md:px-6 md:text-sm"
        >
          <span>{t("shopNow")}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.5}
            className="size-3.5 stroke-current rtl:rotate-180 md:size-4"
          >
            <path
              d="M9 5l7 7-7 7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </div>
    </section>
  );
}
