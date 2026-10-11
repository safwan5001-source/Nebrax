import { cloneElement, Fragment, isValidElement } from "react";
import { AppPromoBand } from "@/components/home/AppPromoBand";
import { BannerBand } from "@/components/home/BannerBand";
import { BenefitsBand } from "@/components/home/BenefitsBand";
import {
  type ContentLabels,
  CustomContentBand,
} from "@/components/home/CustomContentBand";
import { DeliveryPromiseBand } from "@/components/home/DeliveryPromiseBand";
import { DiscoverySection } from "@/components/home/DiscoverySection";
import { FeaturedShelf } from "@/components/home/FeaturedShelf";
import { type GalleryLabels, HomeGallery } from "@/components/home/HomeGallery";
import { HomeSlider, type SliderLabels } from "@/components/home/HomeSlider";
import { OffersShelf } from "@/components/home/OffersShelf";
import { ProductShelfSection } from "@/components/home/ProductShelfSection";
import { SectionBackdrop } from "@/components/home/SectionBackdrop";
import { SectionDesignFrame } from "@/components/home/SectionDesignFrame";
import { SectionReveal } from "@/components/home/SectionReveal";
import type { HomeSectionKey } from "@/lib/home/sections";
import { announcementWindowState } from "@/lib/presentation/announcements";
import {
  mediaBoundsLookup,
  sectionBackdrop,
} from "@/lib/presentation/background-media";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { blockHasContent } from "@/lib/presentation/content-blocks";
import {
  isTextOnly,
  resolveContentBlocks,
} from "@/lib/presentation/content-blocks-resolve";
import { resolveGallery } from "@/lib/presentation/gallery-resolve";
import {
  type HeaderOverlay,
  overlayMarker,
} from "@/lib/presentation/header-overlay";
import type { ResolvedMediaMap } from "@/lib/presentation/media-ref";
import {
  bannerContentOf,
  bannerCtasOf,
  benefitsContentOf,
  customContentOf,
  deliveryPromiseContentOf,
  discoveryContentOf,
  featuredContentOf,
  offersContentOf,
  productShelfContentOf,
} from "@/lib/presentation/section-content";
import type { BenefitsLayout } from "@/lib/presentation/section-design";
import {
  type DesignContext,
  resolveSectionDesign,
} from "@/lib/presentation/section-design-resolve";
import { resolveSlider } from "@/lib/presentation/slider-resolve";
import type { ThemePresetId } from "@/lib/presentation/tokens";

/**
 * CUST-HV V6a (V0 §8.1.3) — whether the page has a visible hero to carry its one `<h1>`. A
 * published document may hold none (hero is deletable); the page then names the store in a
 * visually-hidden `<h1>` instead.
 */
export function hasVisibleHero(
  sections: readonly PresentationHomeSection[],
): boolean {
  return sections.some((section) => section.visible && section.type === "hero");
}

/**
 * The published homepage's section stack (moved out of `page.tsx`, which may only export
 * a page, so it can be tested). Behaviour is unchanged except that a *designed* section
 * is not wrapped in an intermediary div — its `SectionDesignFrame` is the wrapper.
 */
export async function publishedNodes(
  sections: readonly PresentationHomeSection[],
  ctx: {
    implemented: Record<HomeSectionKey, React.ReactNode>;
    /**
     * CUST-HV V6a (V0 §8.1) — renders ONE hero instance from its own content (or the legacy
     * globals while it has none). `headingLevel` is 1 for the first visible hero and 2 for any
     * further one, so the page keeps exactly one `<h1>`. Absent ⇒ the hero is the shared,
     * type-keyed `implemented.hero` node, as before.
     */
    renderHero?: (args: {
      section: PresentationHomeSection;
      headingLevel: 1 | 2;
      designed: boolean;
      /** V6b-3 — the picture layer of a media background, when this hero has a provable one. */
      backdrop?: React.ReactNode;
    }) => React.ReactNode;
    /**
     * CUST-HV V6b-3 — what the server resolved for every published `MediaRef` (keyed by JSON path),
     * including the proven contrast bounds of section-background pictures. Absent ⇒ no picture
     * background can render and every section keeps its legacy surface.
     */
    media?: ResolvedMediaMap;
    /**
     * CUST-HV V6c-1 (V0 §8.4, D-15) — the instant a banner's visibility window is judged against. Absent ⇒ the
     * request time (`Date.now()`): the page is request-time dynamic (`fetchStorefrontConfig` is `no-store`), so
     * a window is evaluated per request with no second scheduler. Injected only by tests.
     */
    nowMs?: number;
    /**
     * CUST-HV V7c-2 — the overlay-on-hero decision (`publishedHeaderOverlay`): the hero it names carries the `data-ho`
     * marker the stylesheet reads to turn the header transparent over it, bleed its picture and reserve the header's
     * height. Absent / `null` ⇒ the header stays solid and nothing changes.
     */
    headerOverlay?: HeaderOverlay | null;
    basePath: string;
    locale: string;
    currency?: string;
    themePreset?: ThemePresetId;
    apps: {
      iosUrl: string;
      androidUrl: string;
      appName: string;
    };
    /**
     * CUST-HV V8b — the slider's accessible names (already translated). Absent ⇒ a published slider cannot be drawn
     * (the section is omitted), never drawn without its names.
     */
    sliderLabels?: SliderLabels;
    /** CUST-HV V8e — the gallery's accessible names (already translated); absent ⇒ a published gallery is omitted. */
    galleryLabels?: GalleryLabels;
    /** CUST-HV V9c-1 — the screen-reader names of the callout tones. */
    contentLabels?: ContentLabels;
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
  const firstHeroId = sections.find(
    (section) => section.visible && section.type === "hero",
  )?.id;
  // V6b-3 — the design resolver learns the proven bounds of each picture background from the
  // server's resolved media, so the automatic text colour is the publish gate's own decision.
  const design: DesignContext = {
    ...ctx.design,
    mediaBounds: mediaBoundsLookup(sections, ctx.media ?? {}),
  };
  const sectionCtx = { ...ctx, design };
  for (const [index, section] of sections.entries()) {
    if (!section.visible) continue;
    const before = nodes.length;
    await pushSectionNode(nodes, section, sectionCtx, firstHeroId, index);
    // CUST-HV V5c — wrap only a section that carries a design; any other section is
    // exactly the node it always was.
    if (section.design && nodes.length === before + 1) {
      nodes[before] = (
        <SectionDesignFrame
          key={section.id}
          section={section}
          context={design}
          extraAttrs={
            ctx.headerOverlay?.sectionId === section.id
              ? { "data-ho": overlayMarker(ctx.headerOverlay) }
              : undefined
          }
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
      resolveSectionDesign(section.type, section.design, design) !== null,
  );
  if (reveals) nodes.push(<SectionReveal key="section-reveal" />);
  return nodes;
}

/**
 * CUST-HV V6b-3 — the picture layer of a section whose design resolves a *provable* media
 * background (the resolver emits the `mbg` token only then), else nothing: the section keeps its
 * legacy surface. The first hero is the page's LCP, so it loads eagerly.
 */
function backdropNode(
  section: PresentationHomeSection,
  index: number,
  ctx: Parameters<typeof publishedNodes>[1],
  priority: boolean,
): React.ReactNode {
  const resolved = resolveSectionDesign(
    section.type,
    section.design,
    ctx.design,
  );
  if (!resolved?.attrs["data-sd"]?.split(" ").includes("mbg")) return null;
  const data = sectionBackdrop(section, index, ctx.media ?? {});
  return data ? <SectionBackdrop data={data} priority={priority} /> : null;
}

async function pushSectionNode(
  nodes: React.ReactNode[],
  section: PresentationHomeSection,
  ctx: Parameters<typeof publishedNodes>[1],
  firstHeroId: string | undefined,
  index: number,
): Promise<void> {
  if (section.type === "hero" && ctx.renderHero) {
    // Instance-keyed (V6a): each hero renders its own content. The same wrapper rules apply as for
    // every other built-in — a designed hero is wrapped by its frame alone, an undesigned one keeps
    // the legacy div, so a content-less default hero is byte-identical to before.
    const framed =
      resolveSectionDesign(section.type, section.design, ctx.design) !== null;
    const isFirstHero = section.id === firstHeroId;
    const node = ctx.renderHero({
      section,
      headingLevel: isFirstHero ? 1 : 2,
      designed: framed,
      backdrop: backdropNode(section, index, ctx, isFirstHero),
    });
    nodes.push(
      framed ? (
        <Fragment key={section.id}>{node}</Fragment>
      ) : (
        <div key={section.id}>{node}</div>
      ),
    );
    return;
  }
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
    // V6c-1 — a banner outside its window is omitted outright (no wrapper, no empty band). Fail-closed: a
    // malformed or inverted window ("invalid") never reads as "no window" — it is rejected at publish, and a
    // hand-built or stale document that still carries one hides the banner rather than showing it everywhere.
    if (
      announcementWindowState(content.window, ctx.nowMs ?? Date.now()) !==
      "open"
    ) {
      return;
    }
    if (
      !content.title &&
      !content.subtitle &&
      !content.imageUrl &&
      !bannerCtasOf(content).some((cta) => cta.label.trim() !== "")
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
        backdrop={backdropNode(section, index, ctx, false)}
        designCtx={ctx.design}
      />,
    );
    return;
  }
  if (section.type === "slider") {
    // CUST-HV V8b (V0 §13.1) — a slider with no resolvable slide is omitted outright (no empty band); the first
    // slide's picture loads eagerly only when the slider opens the page (it is then the likely LCP element).
    const view = ctx.sliderLabels
      ? resolveSlider(section, index, ctx.media ?? {}, ctx.design, ctx.locale)
      : null;
    if (!view || !ctx.sliderLabels) return;
    nodes.push(
      <HomeSlider
        key={section.id}
        view={view}
        labels={ctx.sliderLabels}
        basePath={ctx.basePath}
        dir={ctx.design.dir}
        priority={nodes.length === 0}
        sectionId={section.id}
      />,
    );
    return;
  }
  if (section.type === "gallery") {
    // CUST-HV V8e (V0 §13.2) — a gallery with no resolvable image is omitted outright (no empty band). Its first row
    // loads eagerly only when the gallery opens the page (it is then the likely LCP element).
    const view = ctx.galleryLabels
      ? resolveGallery(section, index, ctx.media ?? {}, ctx.locale)
      : null;
    if (!view || !ctx.galleryLabels) return;
    nodes.push(
      <HomeGallery
        key={section.id}
        view={view}
        labels={ctx.galleryLabels}
        basePath={ctx.basePath}
        dir={ctx.design.dir}
        priority={nodes.length === 0}
        sectionId={section.id}
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
        layout={
          (section.design?.layout as BenefitsLayout | undefined) ?? undefined
        }
      />,
    );
    return;
  }
  if (section.type === "customContent") {
    const content = customContentOf(section);
    // CUST-HV V9c-1 (V0 §15) — a section of nothing but headings and paragraphs draws exactly as it always did; any other
    // block kind takes the general path, whose images are joined to the pictures the server resolved.
    const view = isTextOnly(content.blocks)
      ? undefined
      : resolveContentBlocks(section, index, ctx.media ?? {}, ctx.locale);
    const drawable = view
      ? view.length > 0
      : content.blocks.some((block) => blockHasContent(block));
    if (!drawable) return;
    nodes.push(
      <CustomContentBand
        key={section.id}
        sectionId={section.id}
        content={content}
        themePreset={ctx.themePreset}
        view={view}
        basePath={ctx.basePath}
        labels={ctx.contentLabels}
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
