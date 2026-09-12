import type { Metadata } from "next";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { FeaturedProductsSection } from "@/components/home/FeaturedProductsSection";
import { HeroSection } from "@/components/home/HeroSection";
import { WholesaleSection } from "@/components/home/WholesaleSection";
import { fetchStorefrontName } from "@/lib/commerce/storefront";
import { resolveCurrency } from "@/lib/data/markets";
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

  return (
    <div>
      <HeroSection basePath={basePath} locale={locale} storeName={storeName} />
      <CategoriesSection
        basePath={basePath}
        locale={locale}
        country={country}
      />
      <FeaturedProductsSection
        basePath={basePath}
        locale={locale}
        country={country}
        currency={currency}
      />
      <WholesaleSection basePath={basePath} locale={locale} />
    </div>
  );
}
