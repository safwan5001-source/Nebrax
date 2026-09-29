import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AppPromoBand } from "@/components/home/AppPromoBand";
import { BannerBand } from "@/components/home/BannerBand";
import { BenefitsBand } from "@/components/home/BenefitsBand";
import { CustomContentBand } from "@/components/home/CustomContentBand";
import { FeaturedShelf } from "@/components/home/FeaturedShelf";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { normalizePresentationConfig } from "@/lib/presentation";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { PublishedFrame } from "./frame";
import { HarnessMirror } from "./harness";

/**
 * Development-only visual fixture for the published homepage bands.
 * Mounts the same components as the storefront homepage. Not an authoring
 * surface. Production requests 404. `surface=harness` mounts the storefront
 * customizer mirror so its drift can be seen.
 */

const BANNER_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";

const TOKEN = "AwjUnbrokenToken".repeat(6);

type Scenario =
  | "populated"
  | "empty"
  | "long"
  | "missing-media"
  | "missing-product";

function scenarioOf(value: string | undefined): Scenario {
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

function copy(locale: "ar" | "en", scenario: Scenario) {
  const long = scenario === "long";
  if (locale === "ar") {
    return {
      bannerTitle: long ? TOKEN.slice(0, 120) : "ورد الموسم وصل",
      bannerSubtitle: long
        ? `${TOKEN.slice(0, 80)} تنسيق يومي من المحل إلى الباب`.slice(0, 200)
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
      benefitsTitle: ar.home.benefits,
      featuredTitle: ar.home.featured,
      appTitle: ar.home.appPromo,
      appStoreLabel: ar.home.appStore,
      playStoreLabel: ar.home.playStore,
    };
  }
  return {
    bannerTitle: long ? TOKEN.slice(0, 120) : "Seasonal roses are in",
    bannerSubtitle: long
      ? `${TOKEN.slice(0, 80)} arranged this morning`.slice(0, 200)
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
    benefitsTitle: en.home.benefits,
    featuredTitle: en.home.featured,
    appTitle: en.home.appPromo,
    appStoreLabel: en.home.appStore,
    playStoreLabel: en.home.playStore,
  };
}

export default async function PublishedVisualPage({
  searchParams,
}: {
  searchParams: Promise<{
    locale?: string;
    scenario?: string;
    surface?: string;
  }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ar";
  const scenario = scenarioOf(params.scenario);
  setRequestLocale(locale);
  const text = copy(locale, scenario);
  const empty = scenario === "empty";
  const missingMedia = scenario === "missing-media";
  const basePath = locale === "ar" ? "/sa/ar" : "/sa/en";
  const ios =
    empty || missingMedia ? "" : "https://apps.apple.com/app/id000000000";
  const android =
    empty || missingMedia
      ? ""
      : "https://play.google.com/store/apps/details?id=sa.awj.visual";
  const featuredIds =
    scenario === "missing-product"
      ? ["rose-01", "missing-prod"]
      : missingMedia
        ? ["rose-nophoto"]
        : empty
          ? []
          : scenario === "long"
            ? ["rose-long"]
            : ["rose-01"];

  const presentationInput = {
    version: 2,
    branding: { displayName: locale === "ar" ? "متجر النور" : "Al Noor" },
    apps: { iosUrl: ios, androidUrl: android, appName: text.appName },
    homepage: {
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
                  {
                    id: "b1",
                    title: text.benefitTitle,
                    body: text.benefitBody,
                  },
                  {
                    id: "b2",
                    title:
                      locale === "ar" ? "توصيل نفس اليوم" : "Same-day delivery",
                    body:
                      locale === "ar"
                        ? "داخل الدمام والخبر"
                        : "Dammam and Khobar",
                  },
                  {
                    id: "b3",
                    title:
                      locale === "ar"
                        ? "بدون خصم مخترع"
                        : "No invented discount",
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
  };

  if (params.surface === "harness") {
    return (
      <HarnessMirror
        locale={locale}
        config={normalizePresentationConfig(presentationInput)}
      />
    );
  }

  const banner = empty
    ? null
    : {
        title: text.bannerTitle,
        subtitle: text.bannerSubtitle,
        ctaLabel: text.cta,
        ctaHref: "https://example.com/roses",
        imageUrl: missingMedia ? null : BANNER_IMAGE,
      };

  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      data-visual-root=""
      data-surface="published"
      data-scenario={scenario}
    >
      <StoreContainer className={publishedHomeStackClass("comfortable")}>
        {banner ? (
          <BannerBand
            content={banner}
            basePath={basePath}
            headingId="banner-banner-1"
          />
        ) : null}
        {!empty ? (
          <BenefitsBand
            headingId="benefits-benefits-1"
            title={text.benefitsTitle}
            content={{
              items: [
                { id: "b1", title: text.benefitTitle, body: text.benefitBody },
                {
                  id: "b2",
                  title:
                    locale === "ar" ? "توصيل نفس اليوم" : "Same-day delivery",
                  body:
                    locale === "ar"
                      ? "داخل الدمام والخبر"
                      : "Dammam and Khobar",
                },
                {
                  id: "b3",
                  title:
                    locale === "ar" ? "بدون خصم مخترع" : "No invented discount",
                  body:
                    locale === "ar"
                      ? "السعر يبقى من الكتالوج"
                      : "Price stays on the catalog",
                },
              ],
            }}
          />
        ) : null}
        {!empty ? (
          <CustomContentBand
            sectionId="custom-1"
            content={{
              blocks: [
                { id: "h1", kind: "heading", text: text.heading },
                { id: "p1", kind: "paragraph", text: text.paragraph },
              ],
            }}
          />
        ) : null}
        {featuredIds.length > 0 ? (
          <PublishedFrame locale={locale} messages={locale === "ar" ? ar : en}>
            <FeaturedShelf
              productIds={featuredIds}
              basePath={basePath}
              locale={locale}
              currency="SAR"
              title={text.featuredTitle}
              headingId="featured-featured-1"
            />
          </PublishedFrame>
        ) : null}
        <AppPromoBand
          appName={empty ? "" : text.appName}
          iosUrl={ios}
          androidUrl={android}
          title={text.appTitle}
          appStoreLabel={text.appStoreLabel}
          playStoreLabel={text.playStoreLabel}
          locale={locale}
        />
      </StoreContainer>
    </div>
  );
}
