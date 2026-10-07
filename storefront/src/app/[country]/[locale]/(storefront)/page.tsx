import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { HeroSection } from "@/components/home/HeroSection";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import {
  hasVisibleHero,
  publishedNodes,
} from "@/components/home/published-nodes";
import { WholesaleSection } from "@/components/home/WholesaleSection";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { localeDirection } from "@/i18n/locales";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { resolveCurrency } from "@/lib/data/markets";
import { type HomeSectionKey, resolveHomeSections } from "@/lib/home/sections";
import { generateHomeMetadata } from "@/lib/metadata/home";
import { publishedStoreName } from "@/lib/presentation/public";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import { heroContentOf } from "@/lib/presentation/section-content";

interface HomePageProps {
  params: Promise<{
    country: string;
    locale: string;
  }>;
}

export async function generateMetadata({
  params,
}: HomePageProps): Promise<Metadata> {
  const { country, locale } = await params;
  return generateHomeMetadata({ country, locale });
}

export default async function HomePage({ params }: HomePageProps) {
  const { country, locale } = await params;
  const basePath = `/${country}/${locale}`;
  const [currency, identity] = await Promise.all([
    resolveCurrency(country),
    fetchStorefrontConfig().catch(() => null),
  ]);
  const presentation = identity?.presentation ?? null;
  const liveName = identity?.name?.trim() ? identity.name : null;
  const storeName = publishedStoreName(presentation, liveName, "");
  const heroHeadline = presentation?.homepage.heroHeadline.trim() || null;
  const heroSubheadline = presentation?.homepage.heroSubheadline.trim() || null;
  const homeCopy = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const footerCopy = await getTranslations({
    locale: locale as Locale,
    namespace: "footer",
  });

  const implemented: Record<HomeSectionKey, React.ReactNode> = {
    hero: (
      <HeroSection
        basePath={basePath}
        locale={locale}
        storeName={storeName || null}
        headline={heroHeadline}
        subheadline={heroSubheadline}
        themePreset={presentation?.themePreset}
      />
    ),
    categories: (
      <CategoriesSection
        basePath={basePath}
        locale={locale}
        country={country}
        themePreset={presentation?.themePreset}
      />
    ),
    newArrivals: (
      <NewArrivalsSection
        basePath={basePath}
        locale={locale}
        country={country}
        currency={currency}
        themePreset={presentation?.themePreset}
      />
    ),
    wholesale: <WholesaleSection basePath={basePath} locale={locale} />,
  };

  // No presentation keeps the default implemented stack. A published v2
  // document is already normalized: absence is deletion, and empty authored
  // sections (including an Offers section whose selected offers are not live)
  // render nothing.
  const nodes: React.ReactNode[] = presentation
    ? await publishedNodes(presentation.homepage.sections, {
        implemented,
        // CUST-HV V6a — each hero instance renders its own content; a hero without any keeps
        // reading the legacy `homepage.heroHeadline/heroSubheadline` (V0 §8.1.4).
        renderHero: ({ section, headingLevel, designed }) => {
          const own = heroContentOf(section);
          return (
            <HeroSection
              basePath={basePath}
              locale={locale}
              storeName={storeName || null}
              headline={own ? own.headline : heroHeadline}
              subheadline={own ? (own.subheadline ?? null) : heroSubheadline}
              ctas={own?.ctas ?? null}
              headingId={
                section.id === "hero" ? "home-hero" : `home-hero-${section.id}`
              }
              headingLevel={headingLevel}
              themePreset={presentation.themePreset}
              designed={designed}
            />
          );
        },
        basePath,
        locale,
        currency,
        themePreset: presentation.themePreset,
        apps: presentation.apps,
        benefitsTitle: homeCopy("benefits"),
        featuredTitle: homeCopy("featured"),
        offersTitle: homeCopy("offers"),
        appTitle: homeCopy("appPromo"),
        appStoreLabel: homeCopy("appStore"),
        playStoreLabel: homeCopy("playStore"),
        design: {
          primaryColor: presentation.primaryColor,
          accentColor: presentation.accentColor,
          palette: presentation.palette,
          dir: localeDirection(locale),
        },
      })
    : resolveHomeSections()
        .filter((section) => section.visible)
        .map((section) => (
          <div key={section.key}>{implemented[section.key]}</div>
        ));

  // CUST-HV V6a (V0 §8.1.3) — a home page always has exactly one <h1>: with no visible hero, a
  // visually-hidden one names the store.
  const showsHero = presentation
    ? hasVisibleHero(presentation.homepage.sections)
    : true;

  return (
    <StoreContainer className={publishedHomeStackClass(presentation?.density)}>
      {nodes}
      {showsHero ? null : (
        // last in the stack so its (absolutely positioned) box never alters the vertical rhythm
        <h1 className="sr-only">
          <bdi>{storeName || footerCopy("shop")}</bdi>
        </h1>
      )}
    </StoreContainer>
  );
}
