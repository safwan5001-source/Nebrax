import type { Metadata } from "next";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { HeroSection } from "@/components/home/HeroSection";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import { WholesaleSection } from "@/components/home/WholesaleSection";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { fetchStorefrontName } from "@/lib/commerce/storefront";
import { resolveCurrency } from "@/lib/data/markets";
import { type HomeSectionKey, resolveHomeSections } from "@/lib/home/sections";
import { generateHomeMetadata } from "@/lib/metadata/home";

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
  const [currency, storeName] = await Promise.all([
    resolveCurrency(country),
    fetchStorefrontName(),
  ]);

  // Rendered from the section list rather than in fixed JSX order, so a future
  // published presentation config changes what appears here without the page
  // being rewritten around it. Today it always resolves to the default order:
  // STORE-UI-6 has no persistence contract, so the public storefront must not
  // read a draft.
  const sections: Record<HomeSectionKey, React.ReactNode> = {
    hero: (
      <HeroSection basePath={basePath} locale={locale} storeName={storeName} />
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

  return (
    /*
     * One measure, one vertical rhythm. The homepage is a stack of contained
     * blocks on the page surface rather than a run of full-bleed bands: the
     * bands each needed their own container and their own separator, which is
     * how a page ends up with four different ideas of where its content starts.
     */
    <StoreContainer className="space-y-8 py-4 md:space-y-10 md:py-6">
      {resolveHomeSections()
        .filter((section) => section.visible)
        .map((section) => (
          <div key={section.key}>{sections[section.key]}</div>
        ))}
    </StoreContainer>
  );
}
