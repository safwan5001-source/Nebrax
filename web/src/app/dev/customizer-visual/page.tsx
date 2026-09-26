"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { StorefrontPreviewCanvas } from "@/modules/store-experience-builder/StorefrontPreviewCanvas";
import { normalizePresentationConfig } from "@/modules/store-experience-builder/presentation/config";

/**
 * Development-only visual fixture for the merchant preview canvas.
 * Not an authoring surface and not linked from the product. Production
 * requests 404. The canvas is the same component the commerce appearance
 * builder mounts.
 */

const BANNER_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";

const TOKEN = "AwjUnbrokenToken".repeat(6);

type Scenario = "populated" | "empty" | "long" | "missing-media" | "missing-product";
type PreviewViewport = "mobile" | "tablet" | "desktop";

function scenarioOf(value: string | null): Scenario {
  if (
    value === "empty" ||
    value === "long" ||
    value === "missing-media" ||
    value === "missing-product"
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

function configFor(locale: "ar" | "en", scenario: Scenario) {
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
  const config = configFor(locale, scenario);

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
