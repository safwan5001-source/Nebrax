import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppPromoBand } from "@/components/home/AppPromoBand";
import { BannerBand } from "@/components/home/BannerBand";
import { BenefitsBand } from "@/components/home/BenefitsBand";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { CustomContentBand } from "@/components/home/CustomContentBand";
import { FeaturedShelf } from "@/components/home/FeaturedShelf";
import { HeroSection } from "@/components/home/HeroSection";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import { WholesaleSection } from "@/components/home/WholesaleSection";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { resolveCurrency } from "@/lib/data/markets";
import {
  type HomeSectionKey,
  resolveHomeSections,
} from "@/lib/home/sections";
import { generateHomeMetadata } from "@/lib/metadata/home";
import { publishedStoreName } from "@/lib/presentation/public";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import {
  bannerContentOf,
  benefitsContentOf,
  customContentOf,
  featuredContentOf,
} from "@/lib/presentation/section-content";
import type { PresentationHomeSection } from "@/lib/presentation/config";

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

  const implemented: Record<HomeSectionKey, React.ReactNode> = {
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

  // No presentation keeps the default implemented stack. A published v2
  // document is already normalized: absence is deletion, offers stay
  // unpublished, and empty authored sections render nothing.
  const nodes: React.ReactNode[] = presentation
    ? await publishedNodes(presentation.homepage.sections, {
        implemented,
        basePath,
        locale,
        currency,
        apps: presentation.apps,
        benefitsTitle: homeCopy("benefits"),
        featuredTitle: homeCopy("featured"),
        appTitle: homeCopy("appPromo"),
        appStoreLabel: homeCopy("appStore"),
        playStoreLabel: homeCopy("playStore"),
      })
    : resolveHomeSections()
        .filter((section) => section.visible)
        .map((section) => (
          <div key={section.key}>{implemented[section.key]}</div>
        ));

  return (
    <StoreContainer className={publishedHomeStackClass(presentation?.density)}>
      {nodes}
    </StoreContainer>
  );
}

async function publishedNodes(
  sections: readonly PresentationHomeSection[],
  ctx: {
    implemented: Record<HomeSectionKey, React.ReactNode>;
    basePath: string;
    locale: string;
    currency?: string;
    apps: {
      iosUrl: string;
      androidUrl: string;
      appName: string;
    };
    benefitsTitle: string;
    featuredTitle: string;
    appTitle: string;
    appStoreLabel: string;
    playStoreLabel: string;
  },
): Promise<React.ReactNode[]> {
  const nodes: React.ReactNode[] = [];
  for (const section of sections) {
    if (!section.visible || section.type === "offers") continue;
    if (
      section.type === "hero" ||
      section.type === "categories" ||
      section.type === "newArrivals" ||
      section.type === "wholesale"
    ) {
      nodes.push(
        <div key={section.id}>{ctx.implemented[section.type]}</div>,
      );
      continue;
    }
    if (section.type === "banner") {
      const content = bannerContentOf(section);
      if (
        !content.title &&
        !content.subtitle &&
        !content.imageUrl &&
        !content.ctaLabel
      ) {
        continue;
      }
      nodes.push(
        <BannerBand
          key={section.id}
          content={content}
          basePath={ctx.basePath}
          headingId={`banner-${section.id}`}
        />,
      );
      continue;
    }
    if (section.type === "benefits") {
      const content = benefitsContentOf(section);
      if (!content.items.some((item) => item.title || item.body)) continue;
      nodes.push(
        <BenefitsBand
          key={section.id}
          content={content}
          headingId={`benefits-${section.id}`}
          title={ctx.benefitsTitle}
        />,
      );
      continue;
    }
    if (section.type === "customContent") {
      const content = customContentOf(section);
      if (!content.blocks.some((block) => block.text.trim())) continue;
      nodes.push(<CustomContentBand key={section.id} content={content} />);
      continue;
    }
    if (section.type === "featured") {
      const content = featuredContentOf(section);
      const productIds = content.productIds.filter((id) =>
        /^[a-zA-Z0-9_-]{1,64}$/.test(id),
      );
      if (productIds.length === 0) continue;
      nodes.push(
        <FeaturedShelf
          key={section.id}
          productIds={productIds}
          basePath={ctx.basePath}
          locale={ctx.locale}
          currency={ctx.currency}
          title={ctx.featuredTitle}
        />,
      );
      continue;
    }
    if (section.type === "appPromo") {
      nodes.push(
        <AppPromoBand
          key={section.id}
          appName={ctx.apps.appName}
          iosUrl={ctx.apps.iosUrl}
          androidUrl={ctx.apps.androidUrl}
          title={ctx.appTitle}
          appStoreLabel={ctx.appStoreLabel}
          playStoreLabel={ctx.playStoreLabel}
        />,
      );
    }
  }
  return nodes;
}
