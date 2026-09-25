import type { Metadata } from "next";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { HeroSection } from "@/components/home/HeroSection";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import { WholesaleSection } from "@/components/home/WholesaleSection";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { resolveCurrency } from "@/lib/data/markets";
import {
  type HomeSectionKey,
  resolveHomeSections,
  resolvePublishedImplementedSections,
} from "@/lib/home/sections";
import { generateHomeMetadata } from "@/lib/metadata/home";
import { publishedStoreName } from "@/lib/presentation/public";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";

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

  // Published v2 sections are already normalized. Gated types stay dropped.
  // Absence is a real deletion — do not resurrect omitted sections. No
  // presentation at all keeps the default stack.
  const homeSections = presentation
    ? resolvePublishedImplementedSections(presentation.homepage.sections)
    : resolveHomeSections();

  return (
    /*
     * One measure, one vertical rhythm. The homepage is a stack of contained
     * blocks on the page surface rather than a run of full-bleed bands: the
     * bands each needed their own container and their own separator, which is
     * how a page ends up with four different ideas of where its content starts.
     */
    <StoreContainer className={publishedHomeStackClass(presentation?.density)}>
      {homeSections
        .filter((section) => section.visible)
        .map((section, index) => (
          <div key={`${section.key}-${index}`}>{sections[section.key]}</div>
        ))}
    </StoreContainer>
  );
}
