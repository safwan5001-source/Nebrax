import type { Metadata } from "next";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { HeroSection } from "@/components/home/HeroSection";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import { WholesaleSection } from "@/components/home/WholesaleSection";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { resolveCurrency } from "@/lib/data/markets";
import { type HomeSectionKey, resolveHomeSections } from "@/lib/home/sections";
import { generateHomeMetadata } from "@/lib/metadata/home";
import { publishedStoreName } from "@/lib/presentation/public";

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

  // Rendered from the section list rather than in fixed JSX order, so a
  // published presentation config changes what appears here without the page
  // being rewritten around it. `resolveHomeSections` is called with published
  // sections only when `presentation` is non-null; gated keys remain dropped.
  const sections: Record<HomeSectionKey, React.ReactNode> = {
    hero: (
      <HeroSection
        basePath={basePath}
        locale={locale}
        storeName={storeName || null}
        headline={heroHeadline}
        subheadline={heroSubheadline}
      />
    ),
    categories: (
      <CategoriesSection
        basePath={basePath}
        locale={locale}
        country={country}
      />
    ),
    newArrivals: (
      <NewArrivalsSection
        basePath={basePath}
        locale={locale}
        country={country}
        currency={currency}
      />
    ),
    wholesale: <WholesaleSection basePath={basePath} locale={locale} />,
  };

  const homeSections = presentation
    ? resolveHomeSections(
        presentation.homepage.sections.flatMap((section) => {
          if (
            section.key !== "hero" &&
            section.key !== "categories" &&
            section.key !== "newArrivals" &&
            section.key !== "wholesale"
          ) {
            return [];
          }
          return [{ key: section.key, visible: section.visible }];
        }),
      )
    : resolveHomeSections();

  return (
    /*
     * One measure, one vertical rhythm. The homepage is a stack of contained
     * blocks on the page surface rather than a run of full-bleed bands: the
     * bands each needed their own container and their own separator, which is
     * how a page ends up with four different ideas of where its content starts.
     */
    <StoreContainer className="space-y-8 py-4 md:space-y-10 md:py-6">
      {homeSections
        .filter((section) => section.visible)
        .map((section) => (
          <div key={section.key}>{sections[section.key]}</div>
        ))}
    </StoreContainer>
  );
}
