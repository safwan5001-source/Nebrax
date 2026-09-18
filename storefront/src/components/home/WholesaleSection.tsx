import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { isWholesaleEnabled } from "@/lib/spree";

interface WholesaleSectionProps {
  basePath: string;
  locale: string;
}

/**
 * Trade portal pitch on the homepage. Static by design — no data fetching, so
 * the statically prerendered homepage stays static. It carries the footer's
 * dark band tokens rather than a hard-coded slate, so the one place on the page
 * that inverts stays tied to the shell's own dark surface.
 */
export async function WholesaleSection({
  basePath,
  locale,
}: WholesaleSectionProps) {
  // Opt-in addon: no wholesale pitch on DTC-only storefronts.
  if (!isWholesaleEnabled()) return null;

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });

  const benefits = [
    {
      title: t("wholesaleBenefitPricingTitle"),
      description: t("wholesaleBenefitPricingDescription"),
    },
    {
      title: t("wholesaleBenefitQuickOrderTitle"),
      description: t("wholesaleBenefitQuickOrderDescription"),
    },
    {
      title: t("wholesaleBenefitOrdersTitle"),
      description: t("wholesaleBenefitOrdersDescription"),
    },
  ];

  return (
    /*
     * A contained block like every other homepage section — it used to be a
     * full-bleed slate band with its own container, which broke the page's
     * single measure the moment it was enabled.
     */
    <section
      aria-labelledby="home-wholesale"
      className="rounded-store bg-store-footer px-5 py-10 text-store-footer-link md:px-10 md:py-12"
    >
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
        {/* Pitch + CTAs */}
        <div>
          <span className="inline-flex items-center rounded-full bg-store-footer-border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-store-footer-link">
            {t("wholesaleBadge")}
          </span>
          <h2
            id="home-wholesale"
            className="mt-4 text-xl font-extrabold text-store-footer-foreground md:text-2xl"
          >
            {t("wholesaleTitle")}
          </h2>
          <p className="mt-4 text-sm text-store-footer-muted">
            {t("wholesaleDescription")}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button
              size="lg"
              asChild
              className="bg-store-surface text-store-foreground hover:bg-store-surface-muted"
            >
              <Link href={`${basePath}/wholesale`}>
                {t("wholesaleCtaPrimary")}
              </Link>
            </Button>
            <Button
              variant="outline"
              size="lg"
              asChild
              className="border-store-footer-border bg-transparent text-store-footer-link hover:bg-store-footer-border hover:text-store-footer-foreground"
            >
              <Link href={`${basePath}/wholesale/apply`}>
                {t("wholesaleCtaSecondary")}
              </Link>
            </Button>
          </div>
        </div>

        {/* What approved buyers get — two-up on tablets so it doesn't look sparse */}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {benefits.map((benefit) => (
            <li
              key={benefit.title}
              className="rounded-store border border-store-footer-border bg-store-footer-border/40 px-5 py-4"
            >
              <h3 className="text-sm font-bold text-store-footer-foreground">
                {benefit.title}
              </h3>
              <p className="mt-1 text-sm text-store-footer-muted">
                {benefit.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
