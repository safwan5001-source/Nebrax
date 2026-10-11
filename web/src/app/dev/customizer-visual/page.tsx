"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { StorefrontPreviewCanvas } from "@/modules/store-experience-builder/StorefrontPreviewCanvas";
import {
  type StorefrontPresentationConfig,
  normalizePresentationConfig,
} from "@/modules/store-experience-builder/presentation/config";
import { designConfig } from "./design-scenario";

/**
 * Development-only visual fixture for the merchant preview canvas.
 * Not an authoring surface and not linked from the product. Production
 * requests 404. The canvas is the same component the commerce appearance
 * builder mounts.
 */

const BANNER_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";

const TOKEN = "AwjUnbrokenToken".repeat(6);

type Scenario =
  | "populated"
  | "empty"
  | "long"
  | "missing-media"
  | "missing-product"
  | "data-sections"
  | "design"
  | "global"
  | "heroes"
  | "overlay"
  | "navigation"
  | "footer"
  | "slider";
type PreviewViewport = "mobile" | "tablet" | "desktop";

function scenarioOf(value: string | null): Scenario {
  if (
    value === "empty" ||
    value === "long" ||
    value === "missing-media" ||
    value === "missing-product" ||
    value === "data-sections" ||
    value === "design" ||
    value === "global" ||
    value === "heroes" ||
    value === "overlay" ||
    value === "navigation" ||
    value === "footer" ||
    value === "slider"
  ) {
    return value;
  }
  return "populated";
}

function viewportOf(value: string | null): PreviewViewport {
  if (value === "mobile" || value === "tablet" || value === "desktop") return value;
  return "desktop";
}

function copy(locale: "ar" | "en", scenario: Scenario) {
  const long = scenario === "long";
  if (locale === "ar") {
    return {
      bannerTitle: long ? TOKEN.slice(0, 120) : "ورد الموسم وصل",
      bannerSubtitle: long
        ? `${TOKEN.slice(0, 80)} تنسيق يومي من المحل إلى الباب`
        : "تنسيق طازج يجهز في نفس اليوم داخل المنطقة الشرقية.",
      cta: "تسوق الورود",
      benefitTitle: long ? TOKEN.slice(0, 80) : "تغليف فاخر",
      benefitBody: long
        ? TOKEN.slice(0, 200)
        : "كل باقة تُغلّف داخل المحل قبل التسليم.",
      heading: long ? TOKEN.slice(0, 120) : "من المحل مباشرة",
      paragraph: long
        ? TOKEN.slice(0, 600)
        : "نختار الزهور في الصباح ونرتبها قبل ما تطلع من المحل.",
      appName: "تطبيق النور",
    };
  }
  return {
    bannerTitle: long ? TOKEN.slice(0, 120) : "Seasonal roses are in",
    bannerSubtitle: long
      ? `${TOKEN.slice(0, 80)} arranged this morning`
      : "Arranged this morning and delivered across the Eastern Province.",
    cta: "Shop roses",
    benefitTitle: long ? TOKEN.slice(0, 80) : "Wrapped in store",
    benefitBody: long
      ? TOKEN.slice(0, 200)
      : "Each bunch is wrapped before it leaves the shop.",
    heading: long ? TOKEN.slice(0, 120) : "From the shop floor",
    paragraph: long
      ? TOKEN.slice(0, 600)
      : "We cut and arrange the flowers before the order leaves the store.",
    appName: "Al Noor",
  };
}

/** FLOWERS-H9c — the three data-backed sections (ADR-21), authored and incomplete. */
function dataSectionsConfig(locale: "ar" | "en") {
  const ar = locale === "ar";
  return normalizePresentationConfig({
    version: 2,
    branding: { displayName: ar ? "متجر النور" : "Al Noor" },
    homepage: {
      sections: [
        {
          id: "promise-1",
          type: "deliveryPromise",
          visible: true,
          content: { title: ar ? "توصيل طازج" : "Fresh delivery", body: "" },
        },
        {
          id: "shelf-1",
          type: "productShelf",
          visible: true,
          content: {
            title: ar ? "ورود لليوم" : "Roses for today",
            source: { kind: "collection", slug: "roses" },
            deliverToday: true,
            limit: 8,
          },
        },
        {
          id: "discovery-1",
          type: "discovery",
          visible: true,
          content: { title: "", axis: "facet", dimension: "occasion", display: "tiles" },
        },
        // No stored content: the builder flags it as not appearing in the store.
        { id: "shelf-2", type: "productShelf", visible: true },
      ],
    },
  });
}

function configFor(locale: "ar" | "en", scenario: Scenario, footerLayout: string | null = null): StorefrontPresentationConfig {
  if (scenario === "global") {
    // CUST-HV V5e-2a — the populated page wearing every global token at its boldest step.
    const base = configFor(locale, "populated");
    const shelves = (["categories", "newArrivals"] as const)
      .filter((type) => !base.homepage.sections.some((section) => section.type === type))
      .map((type) => ({ id: type, type, visible: true }));
    return normalizePresentationConfig({
      ...base,
      homepage: { ...base.homepage, sections: [...shelves, ...base.homepage.sections] },
      typography: { headingScale: "lg", bodyScale: "lg", headingWeight: 800, bodyWeight: 500, lineHeight: "relaxed", sectionHeading: "underline", headingFamily: "amiri-lora", bodyFamily: "readex", buttonText: { weight: 800, case: "upper" } },
      buttons: { style: "soft", size: "lg", radius: "pill", colour: "brand", hover: "lift" },
      surfaces: { radius: "pill", border: { width: "medium" }, shadow: "medium" },
      layout: { contentWidth: "narrow" },
      motion: { duration: "slow", easing: "emphasized" },
    });
  }
  if (scenario === "footer") {
    // CUST-HV V7e-3 — a footer with link groups, contact, social, WhatsApp and an app badge; `?layout=` picks one of the six.
    const ar = locale === "ar";
    const link = (id: string, label: string, target: unknown) => ({ id, label, target, enabled: true });
    return normalizePresentationConfig({
      ...configFor(locale, "populated"),
      footer: {
        tagline: ar ? "ورود طازجة تصل إلى بابك كل يوم" : "Fresh flowers delivered to your door every day",
        showLogo: true,
        copyright: ar ? "© متجر الأزهار" : "© Daisy Shop Flowers",
        ...(footerLayout ? { layout: footerLayout } : {}),
        groups: Array.from({ length: 6 }, (_, i) => ({
          id: `g${i + 1}`,
          title: (ar ? ["التسوق", "الشركة", "الدعم", "القانونية", "الشركاء", "المجتمع"] : ["Shop", "Company", "Support", "Legal", "Partners", "Community"])[i],
          links: [
            link(`g${i}a`, ar ? "العروض" : "Offers", { kind: "home" }),
            link(`g${i}b`, ar ? "سياسة الخصوصية" : "Privacy policy", { kind: "content", slug: "privacy-policy" }),
            link(`g${i}c`, ar ? "مدونتنا" : "Our blog", { kind: "external", href: "https://example.com/blog", newTab: true }),
          ],
        })),
      },
      contact: { phone: "+966500000000", email: "hello@daisy.sa", address: ar ? "الرياض" : "Riyadh", hours: "" },
      social: [{ id: "i", network: "instagram", url: "https://instagram.com/daisy", enabled: true }],
      whatsapp: { enabled: true, phone: "966500000000", message: "", placement: "footer" },
      apps: { iosUrl: "https://apps.apple.com/app/id1", androidUrl: "", appName: "", showHomepageSection: false, showFooterLinks: true },
    });
  }
  if (scenario === "navigation") {
    // CUST-HV V7d-3 — a `main` menu with plain items, a badge + icon item, and a dropdown parent with children.
    const ar = locale === "ar";
    return normalizePresentationConfig({
      ...configFor(locale, "populated"),
      navigation: {
        menus: [
          {
            id: "main",
            items: [
              { id: "n1", label: ar ? "العروض" : "Offers", icon: "percent", badge: { text: ar ? "جديد" : "New", tone: "accent" }, target: { kind: "home" } },
              {
                id: "n2",
                label: ar ? "المتجر" : "Shop",
                target: { kind: "home" },
                presentation: { kind: "dropdown" },
                children: [
                  { id: "n2a", label: ar ? "الورود" : "Roses", icon: "heart", target: { kind: "category", id: "c1" } },
                  { id: "n2b", label: ar ? "الهدايا والمناسبات الخاصة" : "Gifts and special occasions", target: { kind: "category", id: "c2" } },
                  { id: "n2c", label: ar ? "مدونتنا" : "Our blog", icon: "globe", target: { kind: "external", href: "https://example.com/blog", newTab: true } },
                ],
              },
              { id: "n3", label: ar ? "سياسة الخصوصية" : "Privacy policy", target: { kind: "content", slug: "privacy-policy" } },
              { id: "n4", label: ar ? "من نحن" : "About us", target: { kind: "content", slug: "about" } },
            ],
          },
        ],
      },
    });
  }
  if (scenario === "slider") {
    // CUST-HV V8c — a slider above the catalogue. The e2e specs mock the media endpoints: picture A is dark with proven bounds, picture B has
    // none (so its slide draws the brand surface), picture C is a light one (the copy turns dark).
    const ar = locale === "ar";
    const slide = (id: string, mediaId: string, heading: string, sub: string, label: string, extra: Record<string, unknown> = {}) => ({
      id,
      media: { mediaId, decorative: true },
      heading,
      sub,
      cta: { label, href: "/collections/new" },
      ...extra,
    });
    return normalizePresentationConfig({
      ...configFor(locale, "populated"),
      homepage: {
        ...configFor(locale, "populated").homepage,
        sections: [
          {
            id: "sl",
            type: "slider",
            visible: true,
            content: {
              slides: [
                slide("s1", "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e", ar ? "الربيع في أبهى صوره" : "Spring in bloom", ar ? "ورود طازجة تصل إلى بابك كل صباح." : "Fresh flowers, delivered every morning.", ar ? "تسوّق الربيع" : "Shop spring"),
                slide("s2", "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f", ar ? "شريحة بلا إثبات" : "A slide with no proof", ar ? "صورتها بلا بيانات تباين." : "Its picture has no contrast evidence.", ar ? "اطلب الآن" : "Order now", { align: "center" }),
                slide("s3", "2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70", ar ? "هدايا تدوم" : "Gifts that last", ar ? "صناديق ونباتات لكل مناسبة." : "Boxes and plants for every occasion.", ar ? "شاهد الهدايا" : "See gifts", { align: "end" }),
              ],
            },
          },
          ...configFor(locale, "populated").homepage.sections.filter((section) => section.type !== "hero"),
        ],
      },
    });
  }
  if (scenario === "overlay") {
    // CUST-HV V7c-2 — a header that overlays a full-picture hero (the e2e spec mocks the media endpoints with a
    // dark picture, so the proof passes) above the catalogue.
    const ar = locale === "ar";
    return normalizePresentationConfig({
      ...configFor(locale, "populated"),
      header: { design: { mode: "overlay-hero" } },
      homepage: {
        ...configFor(locale, "populated").homepage,
        sections: [
          {
            id: "hero",
            type: "hero",
            visible: true,
            content: {
              headline: ar ? "مرحباً بكم في متجر الأزهار الطازجة" : "Welcome to the fresh flower shop",
              subheadline: ar ? "توصيل في نفس اليوم إلى كل أحياء المدينة" : "Same-day delivery across the whole city",
              ctas: [{ label: ar ? "تسوّق الوصول الجديد" : "Shop new arrivals", href: "/collections/new" }],
            },
            design: {
              background: {
                kind: "media",
                media: { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e", decorative: true },
                overlay: { color: { role: "overlay" }, alpha: 40 },
              },
            },
          },
          // the populated catalogue below the hero, so the page is tall enough to scroll
          ...configFor(locale, "populated").homepage.sections.filter((section) => section.type !== "hero"),
        ],
      },
    });
  }
  if (scenario === "heroes") {
    // CUST-HV V6a — two per-instance heroes (the first with a supporting line and two buttons, the
    // second explicitly empty so it shows the store name and the default CTA) above the catalogue.
    const ar = locale === "ar";
    return normalizePresentationConfig({
      ...configFor(locale, "populated"),
      homepage: {
        ...configFor(locale, "populated").homepage,
        sections: [
          {
            id: "hero",
            type: "hero",
            visible: true,
            content: {
              headline: ar ? "مرحباً بكم في متجر الأزهار الطازجة" : "Welcome to the fresh flower shop",
              subheadline: ar ? "توصيل في نفس اليوم إلى كل أحياء المدينة" : "Same-day delivery across the whole city",
              ctas: [
                { label: ar ? "تسوّق الوصول الجديد" : "Shop new arrivals", href: "/collections/new" },
                { label: ar ? "قصتنا" : "Our story", href: "https://example.com/about" },
              ],
            },
          },
          { id: "hero-2", type: "hero", visible: true, content: { headline: "" } },
          { id: "categories", type: "categories", visible: true },
        ],
      },
    });
  }
  if (scenario === "design") return designConfig(configFor(locale, "populated"), dataSectionsConfig(locale));
  if (scenario === "data-sections") return dataSectionsConfig(locale);
  const text = copy(locale, scenario);
  const empty = scenario === "empty";
  const missingMedia = scenario === "missing-media";
  const apps =
    scenario === "empty" || scenario === "missing-media"
      ? { iosUrl: "", androidUrl: "", appName: "" }
      : {
          iosUrl: "https://apps.apple.com/app/id000000000",
          androidUrl: "https://play.google.com/store/apps/details?id=sa.awj.visual",
          appName: text.appName,
        };
  const featuredIds =
    scenario === "missing-product"
      ? ["rose-01", "missing-prod"]
      : scenario === "missing-media"
        ? ["rose-nophoto"]
        : empty
          ? []
          : ["rose-01"];

  return normalizePresentationConfig({
    version: 2,
    branding: { displayName: locale === "ar" ? "متجر النور" : "Al Noor" },
    apps,
    homepage: {
      heroHeadline: locale === "ar" ? "زهور تُرتّب اليوم" : "Flowers arranged today",
      heroSubheadline:
        locale === "ar" ? "من المحل إلى الباب" : "From the shop to the door",
      sections: [
        {
          id: "banner-1",
          type: "banner",
          visible: true,
          content: empty
            ? undefined
            : {
                title: text.bannerTitle,
                subtitle: text.bannerSubtitle,
                ctaLabel: text.cta,
                ctaHref: "https://example.com/roses",
                imageUrl: missingMedia ? "" : BANNER_IMAGE,
              },
        },
        {
          id: "benefits-1",
          type: "benefits",
          visible: true,
          content: empty
            ? undefined
            : {
                items: [
                  { id: "b1", title: text.benefitTitle, body: text.benefitBody },
                  {
                    id: "b2",
                    title: locale === "ar" ? "توصيل نفس اليوم" : "Same-day delivery",
                    body: locale === "ar" ? "داخل الدمام والخبر" : "Dammam and Khobar",
                  },
                  {
                    id: "b3",
                    title: locale === "ar" ? "بدون خصم مخترع" : "No invented discount",
                    body:
                      locale === "ar"
                        ? "السعر يبقى من الكتالوج"
                        : "Price stays on the catalog",
                  },
                ],
              },
        },
        {
          id: "custom-1",
          type: "customContent",
          visible: true,
          content: empty
            ? undefined
            : {
                blocks: [
                  { id: "h1", kind: "heading", text: text.heading },
                  { id: "p1", kind: "paragraph", text: text.paragraph },
                ],
              },
        },
        {
          id: "featured-1",
          type: "featured",
          visible: true,
          content: featuredIds.length ? { productIds: featuredIds } : undefined,
        },
        { id: "offers-1", type: "offers", visible: true },
        { id: "app-1", type: "appPromo", visible: true },
      ],
    },
  });
}

function Fixture() {
  const params = useSearchParams();
  const locale = params.get("locale") === "en" ? "en" : "ar";
  const scenario = scenarioOf(params.get("scenario"));
  const viewport = viewportOf(params.get("viewport"));
  const config = configFor(locale, scenario, params.get("layout"));

  return (
    <main data-visual-root="" data-surface="merchant-preview" data-scenario={scenario}>
      <StorefrontPreviewCanvas
        config={config}
        locale={locale}
        viewport={viewport}
        liveStoreName={locale === "ar" ? "متجر النور" : "Al Noor"}
        onSelectSection={() => {}}
        onSelectChrome={() => {}}
      />
    </main>
  );
}

export default function CustomizerVisualPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <Suspense>
      <Fixture />
    </Suspense>
  );
}
