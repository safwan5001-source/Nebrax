import { cloneElement, Fragment, isValidElement } from "react";
import { AppPromoBand } from "@/components/home/AppPromoBand";
import { BannerBand } from "@/components/home/BannerBand";
import { BenefitsBand } from "@/components/home/BenefitsBand";
import { CustomContentBand } from "@/components/home/CustomContentBand";
import { DeliveryPromiseBand } from "@/components/home/DeliveryPromiseBand";
import { DiscoverySection } from "@/components/home/DiscoverySection";
import { FeaturedShelf } from "@/components/home/FeaturedShelf";
import { OffersShelf } from "@/components/home/OffersShelf";
import { ProductShelfSection } from "@/components/home/ProductShelfSection";
import { SectionDesignFrame } from "@/components/home/SectionDesignFrame";
import { SectionReveal } from "@/components/home/SectionReveal";
import type { HomeSectionKey } from "@/lib/home/sections";
import type { PresentationHomeSection } from "@/lib/presentation/config";
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
import {
  type DesignContext,
  resolveSectionDesign,
} from "@/lib/presentation/section-design-resolve";
import type { ThemePresetId } from "@/lib/presentation/tokens";

/**
 * The published homepage's section stack (moved out of `page.tsx`, which may only export
 * a page, so it can be tested). Behaviour is unchanged except that a *designed* section
 * is not wrapped in an intermediary div — its `SectionDesignFrame` is the wrapper.
 */
export async function publishedNodes(
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
  // One observer for the whole stack, mounted only when a visible section opted into the reveal.
  const reveals = sections.some(
    (section) =>
      section.visible &&
      section.design?.motion?.reveal === "fade-up" &&
      resolveSectionDesign(section.type, section.design, ctx.design) !== null,
  );
  if (reveals) nodes.push(<SectionReveal key="section-reveal" />);
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
    // A designed section is wrapped by its `SectionDesignFrame` (a div in the same flow
    // position), and the design rules address the frame's *direct child* as the section's
    // own surface — so no intermediary div may sit between them.
    // ...but only when the design actually resolves to a frame: a design that renders
    // nothing (e.g. only default steps) keeps the legacy wrapper byte-for-byte.
    const framed =
      resolveSectionDesign(section.type, section.design, ctx.design) !== null;
    const node = ctx.implemented[section.type];
    // The hero's content-box marker is emitted only while a design frame is active, so an
    // undesigned hero stays byte-identical to its legacy output.
    const rendered =
      framed && section.type === "hero" && isValidElement(node)
        ? cloneElement(node as React.ReactElement<{ designed?: boolean }>, {
            designed: true,
          })
        : node;
    nodes.push(
      framed ? (
        <Fragment key={section.id}>{rendered}</Fragment>
      ) : (
        <div key={section.id}>{ctx.implemented[section.type]}</div>
      ),
    );
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
        designed={
          resolveSectionDesign(section.type, section.design, ctx.design) !==
          null
        }
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
        designed={
          resolveSectionDesign(section.type, section.design, ctx.design) !==
          null
        }
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
