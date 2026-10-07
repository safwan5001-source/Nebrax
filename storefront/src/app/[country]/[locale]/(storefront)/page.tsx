import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppPromoBand } from "@/components/home/AppPromoBand";
import { BannerBand } from "@/components/home/BannerBand";
import { BenefitsBand } from "@/components/home/BenefitsBand";
import { CategoriesSection } from "@/components/home/CategoriesSection";
import { CustomContentBand } from "@/components/home/CustomContentBand";
import { DeliveryPromiseBand } from "@/components/home/DeliveryPromiseBand";
import { DiscoverySection } from "@/components/home/DiscoverySection";
import { FeaturedShelf } from "@/components/home/FeaturedShelf";
import { HeroSection } from "@/components/home/HeroSection";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import { OffersShelf } from "@/components/home/OffersShelf";
import { ProductShelfSection } from "@/components/home/ProductShelfSection";
import { SectionDesignFrame } from "@/components/home/SectionDesignFrame";
import { WholesaleSection } from "@/components/home/WholesaleSection";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { localeDirection } from "@/i18n/locales";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { resolveCurrency } from "@/lib/data/markets";
import { type HomeSectionKey, resolveHomeSections } from "@/lib/home/sections";
import { generateHomeMetadata } from "@/lib/metadata/home";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { publishedStoreName } from "@/lib/presentation/public";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import {
  bannerContentOf,
  benefitsContentOf,
  customContentOf,
  deliveryPromiseContentOf,
  discoveryContentOf,
  featuredContentOf,
  offersContentOf,
  productShelfContentOf,
} from "@/lib/presentation/section-content";
import type { DesignContext } from "@/lib/presentation/section-design-resolve";
import type { ThemePresetId } from "@/lib/presentation/tokens";

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
    themePreset?: ThemePresetId;
    apps: {
      iosUrl: string;
      androidUrl: string;
      appName: string;
    };
    benefitsTitle: string;
    featuredTitle: string;
    offersTitle: string;
    appTitle: string;
    appStoreLabel: string;
    playStoreLabel: string;
    design: DesignContext;
  },
): Promise<React.ReactNode[]> {
  const nodes: React.ReactNode[] = [];
  for (const section of sections) {
    if (!section.visible) continue;
    const before = nodes.length;
    await pushSectionNode(nodes, section, ctx);
    // CUST-HV V5c — wrap only a section that carries a design; any other section is
    // exactly the node it always was.
    if (section.design && nodes.length === before + 1) {
      nodes[before] = (
        <SectionDesignFrame
          key={section.id}
          section={section}
          context={ctx.design}
        >
          {nodes[before]}
        </SectionDesignFrame>
      );
    }
  }
  return nodes;
}

async function pushSectionNode(
  nodes: React.ReactNode[],
  section: PresentationHomeSection,
  ctx: Parameters<typeof publishedNodes>[1],
): Promise<void> {
  if (
    section.type === "hero" ||
    section.type === "categories" ||
    section.type === "newArrivals" ||
    section.type === "wholesale"
  ) {
    nodes.push(<div key={section.id}>{ctx.implemented[section.type]}</div>);
    return;
  }
  if (section.type === "banner") {
    const content = bannerContentOf(section);
    if (
      !content.title &&
      !content.subtitle &&
      !content.imageUrl &&
      !content.ctaLabel
    ) {
      return;
    }
    nodes.push(
      <BannerBand
        key={section.id}
        content={content}
        basePath={ctx.basePath}
        headingId={`banner-${section.id}`}
      />,
    );
    return;
  }
  if (section.type === "benefits") {
    const content = benefitsContentOf(section);
    if (!content.items.some((item) => item.title || item.body)) return;
    nodes.push(
      <BenefitsBand
        key={section.id}
        content={content}
        headingId={`benefits-${section.id}`}
        title={ctx.benefitsTitle}
      />,
    );
    return;
  }
  if (section.type === "customContent") {
    const content = customContentOf(section);
    if (!content.blocks.some((block) => block.text.trim())) return;
    nodes.push(
      <CustomContentBand
        key={section.id}
        sectionId={section.id}
        content={content}
        themePreset={ctx.themePreset}
      />,
    );
    return;
  }
  if (section.type === "featured") {
    const content = featuredContentOf(section);
    const productIds = content.productIds.filter((id) =>
      /^[a-zA-Z0-9_-]{1,64}$/.test(id),
    );
    if (productIds.length === 0) return;
    nodes.push(
      <FeaturedShelf
        key={section.id}
        productIds={productIds}
        basePath={ctx.basePath}
        locale={ctx.locale}
        currency={ctx.currency}
        title={ctx.featuredTitle}
        headingId={`featured-${section.id}`}
        themePreset={ctx.themePreset}
      />,
    );
    return;
  }
  if (section.type === "offers") {
    // CUST-H4-7 — real Offers. The stored ids are references to
    // `storefront_offers`; liveness, prices and the discount come from the
    // Host-resolved `GET /store/v1/offers` inside `OffersShelf`.
    const offerIds = offersContentOf(section).offerIds.filter((id) =>
      /^[a-zA-Z0-9_-]{1,64}$/.test(id),
    );
    if (offerIds.length === 0) return;
    nodes.push(
      <OffersShelf
        key={section.id}
        offerIds={offerIds}
        basePath={ctx.basePath}
        title={ctx.offersTitle}
        headingId={`offers-${section.id}`}
      />,
    );
    return;
  }
  if (section.type === "productShelf") {
    // FLOWERS-H9b / ADR-21 — a source reference and/or deliver-today only;
    // products, prices and availability are read live inside the section.
    const content = productShelfContentOf(section);
    if (!content.source && !content.deliverToday) return;
    nodes.push(
      <ProductShelfSection
        key={section.id}
        content={content}
        basePath={ctx.basePath}
        locale={ctx.locale}
        currency={ctx.currency}
        headingId={`shelf-${section.id}`}
        themePreset={ctx.themePreset}
      />,
    );
    return;
  }
  if (section.type === "discovery") {
    const content = discoveryContentOf(section);
    if (content.axis === "facet" && !content.dimension) return;
    nodes.push(
      <DiscoverySection
        key={section.id}
        content={content}
        basePath={ctx.basePath}
        locale={ctx.locale}
        headingId={`discovery-${section.id}`}
      />,
    );
    return;
  }
  if (section.type === "deliveryPromise") {
    nodes.push(
      <DeliveryPromiseBand
        key={section.id}
        content={deliveryPromiseContentOf(section)}
        locale={ctx.locale}
        headingId={`delivery-promise-${section.id}`}
      />,
    );
    return;
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
        locale={ctx.locale}
      />,
    );
  }
}
