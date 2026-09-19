import Link from "next/link";
import { getTranslations } from "next-intl/server";

interface HeroSectionProps {
  basePath: string;
  locale: string;
  storeName: string | null;
  /**
   * Merchant-configured hero content. AWJ exposes no hero contract today, so
   * nothing supplies these yet; they exist so STORE-UI-6 can fill the band
   * without the homepage being restructured around it.
   */
  headline?: string | null;
  subheadline?: string | null;
}

/**
 * The storefront masthead.
 *
 * It states who the store is and offers one way into the catalogue, and that is
 * all it claims. `store/v1/storefront` carries a name and a default locale —
 * no banner, no tagline, no campaign — so there is nothing else here that would
 * be true.
 *
 * With no merchant image to place, the band is deliberately plain: the store's
 * name set large on the approved palette, one CTA, and nothing else. An earlier
 * pass filled the empty side with an oversized translucent initial; that read
 * as placeholder decoration and was removed rather than replaced, because
 * anything put there — a monogram, an illustration, a stock photograph — would
 * be storefront invention standing in for merchant content. The band is not
 * made taller to compensate for the space it no longer fills.
 */
export async function HeroSection({
  basePath,
  locale,
  storeName,
  headline,
  subheadline,
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

  return (
    <section
      aria-labelledby="home-hero"
      className="flex min-h-[11rem] items-center rounded-store bg-linear-to-r rtl:bg-linear-to-l from-primary-700 via-primary-600 to-primary-500 text-store-primary-foreground md:min-h-[16rem] lg:min-h-[18rem]"
    >
      <div className="max-w-2xl p-5 md:p-10 lg:p-14">
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
