import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AppPromoBand } from "@/components/home/AppPromoBand";
import { Footer } from "@/components/layout/Footer";
import { StoreWhatsApp } from "@/components/layout/StoreWhatsApp";
import { normalizePresentationConfig } from "@/lib/presentation";
import {
  publishedSocialLinks,
  publishedWhatsAppHref,
} from "@/lib/presentation/public";
import {
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  sanitizeExternalUrl,
} from "@/lib/presentation/urls";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { DirectionLock } from "./direction";
import { TrustMirror } from "./mirror";

/**
 * Development-only fixture for STORE-TRUST-QA-1.
 * `surface=published` mounts the real Footer, AppPromoBand, and StoreWhatsApp
 * with the same public helpers the storefront layout uses. It is not the
 * `/[country]/[locale]` production route. `surface=mirror` mounts the
 * storefront customizer mirror, which is not the merchant editor.
 * Production requests 404.
 */

const NETWORKS = [
  "instagram",
  "x",
  "tiktok",
  "snapchat",
  "youtube",
  "linkedin",
  "facebook",
] as const;

const SOCIAL_URL: Record<(typeof NETWORKS)[number], string> = {
  instagram: "https://instagram.com/awj",
  x: "https://x.com/awj",
  tiktok: "https://www.tiktok.com/@awj",
  snapchat: "https://www.snapchat.com/add/awj",
  youtube: "https://www.youtube.com/@awj",
  linkedin: "https://www.linkedin.com/company/awj",
  facebook: "https://www.facebook.com/awj",
};

const LONG = "AwjUnbrokenToken".repeat(12);
const DECOY_CR = "DECOY-CR-NOT-CANONICAL";

type Scenario =
  | "empty"
  | "partial"
  | "full"
  | "unsafe"
  | "long"
  | "missing-identity"
  | "sbc-plain"
  | "apps-one";

function scenarioOf(value: string | undefined): Scenario {
  if (
    value === "empty" ||
    value === "partial" ||
    value === "full" ||
    value === "unsafe" ||
    value === "long" ||
    value === "missing-identity" ||
    value === "sbc-plain" ||
    value === "apps-one"
  ) {
    return value;
  }
  return "full";
}

function viewportOf(
  value: string | undefined,
): "mobile" | "tablet" | "desktop" {
  if (value === "mobile" || value === "tablet" || value === "desktop") {
    return value;
  }
  return "desktop";
}

export default async function TrustVisualPage({
  searchParams,
}: {
  searchParams: Promise<{
    locale?: string;
    scenario?: string;
    surface?: string;
    viewport?: string;
  }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ar";
  const scenario = scenarioOf(params.scenario);
  const surface = params.surface === "mirror" ? "mirror" : "published";
  const viewport = viewportOf(params.viewport);
  setRequestLocale(locale);

  const messages = locale === "ar" ? ar : en;
  const long = scenario === "long";
  const storeName = long
    ? LONG.slice(0, 80)
    : locale === "ar"
      ? "متجر النور"
      : "Al Noor";
  const legal =
    scenario === "empty" || scenario === "missing-identity"
      ? null
      : long
        ? LONG
        : locale === "ar"
          ? "شركة النور للتجارة"
          : "Al Noor Trading Company";
  const showCrVat = scenario === "full" || scenario === "long";
  const businessIdentity = {
    legal_name: legal,
    cr_number: showCrVat ? "7050247977" : null,
    vat_number: showCrVat ? "310123456700003" : null,
  };
  const social =
    scenario === "full" || scenario === "long"
      ? NETWORKS.map((network) => ({
          id: network,
          network,
          url: SOCIAL_URL[network],
          enabled: true,
        }))
      : scenario === "partial" || scenario === "missing-identity"
        ? [
            {
              id: "instagram",
              network: "instagram" as const,
              url: SOCIAL_URL.instagram,
              enabled: true,
            },
          ]
        : scenario === "unsafe"
          ? [
              {
                id: "instagram",
                network: "instagram" as const,
                url: SOCIAL_URL.instagram,
                enabled: true,
              },
              {
                id: "x",
                network: "x" as const,
                url: "javascript:alert(1)",
                enabled: true,
              },
              {
                id: "tiktok",
                network: "tiktok" as const,
                url: "http://evil.example/t",
                enabled: true,
              },
            ]
          : [];
  const apps =
    scenario === "empty" || scenario === "sbc-plain"
      ? { iosUrl: "", androidUrl: "", show: false }
      : scenario === "apps-one" || scenario === "partial"
        ? {
            iosUrl: "https://apps.apple.com/app/id000000000",
            androidUrl: "",
            show: scenario === "apps-one",
          }
        : scenario === "unsafe"
          ? {
              iosUrl: "https://www.apple.com/iphone",
              androidUrl:
                "https://play.google.com/store/apps/details?id=sa.awj",
              show: true,
            }
          : {
              iosUrl: "https://apps.apple.com/app/id000000000",
              androidUrl:
                "https://play.google.com/store/apps/details?id=sa.awj",
              show: true,
            };
  const whatsappOn =
    scenario === "full" ||
    scenario === "long" ||
    scenario === "partial" ||
    scenario === "missing-identity" ||
    scenario === "unsafe";
  const config = normalizePresentationConfig({
    version: 2,
    branding: { displayName: storeName },
    footer: {
      tagline: long ? LONG : scenario === "empty" ? "" : "Eastern Province",
      showLogo: true,
      copyright: "",
    },
    contact:
      scenario === "empty" || scenario === "sbc-plain"
        ? {}
        : {
            phone: "+966500000001",
            email: long ? `${"a".repeat(40)}@example.com` : "shop@example.com",
            address: long
              ? LONG
              : locale === "ar"
                ? "الدمام، المنطقة الشرقية"
                : "Dammam, Eastern Province",
            hours: locale === "ar" ? "٩ ص – ٩ م" : "9:00–21:00",
          },
    whatsapp: {
      enabled: whatsappOn,
      phone: scenario === "unsafe" ? "not-a-phone" : "+966500000000",
      message: "",
      placement: scenario === "partial" ? "footer" : "both",
    },
    social,
    verification: {
      crNumber: DECOY_CR,
      licenseNumber:
        scenario === "empty" || scenario === "missing-identity" ? "" : "LIC-42",
    },
    sbc: {
      show_in_storefront:
        scenario === "full" || scenario === "long" || scenario === "sbc-plain",
      seal_token:
        scenario === "full" || scenario === "long" ? "official-token" : "",
    },
    apps: {
      iosUrl: apps.iosUrl,
      androidUrl: apps.androidUrl,
      appName: locale === "ar" ? "تطبيق النور" : "Al Noor",
      showHomepageSection: apps.show,
      showFooterLinks: apps.show,
    },
    homepage: {
      sections: [{ id: "app-1", type: "appPromo", visible: apps.show }],
    },
  });
  const basePath = locale === "ar" ? "/sa/ar" : "/sa/en";

  if (surface === "mirror") {
    return (
      <>
        <DirectionLock locale={locale} />
        <TrustMirror
          config={config}
          locale={locale}
          viewport={viewport}
          storeName={storeName}
          businessIdentity={businessIdentity}
        />
      </>
    );
  }

  const ios = config.apps.showFooterLinks
    ? sanitizeExternalUrl(config.apps.iosUrl)
    : null;
  const android = config.apps.showFooterLinks
    ? sanitizeExternalUrl(config.apps.androidUrl)
    : null;
  const appLinks = [
    ios && isSafeAppStoreUrl(ios)
      ? {
          id: "app-ios",
          store: "apple" as const,
          label: "App Store",
          href: ios,
        }
      : null,
    android && isSafePlayStoreUrl(android)
      ? {
          id: "app-android",
          store: "google" as const,
          label: "Google Play",
          href: android,
        }
      : null,
  ].filter((item) => item !== null);
  const floating = publishedWhatsAppHref(config, "floating");

  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      data-trust-surface="published"
      data-scenario={scenario}
      data-locale={locale}
    >
      <DirectionLock locale={locale} />
      <div data-trust-app-promo="">
        <AppPromoBand
          appName={config.apps.appName}
          iosUrl={config.apps.showHomepageSection ? config.apps.iosUrl : ""}
          androidUrl={
            config.apps.showHomepageSection ? config.apps.androidUrl : ""
          }
          title={messages.home.appPromo}
          appStoreLabel={messages.home.appStore}
          playStoreLabel={messages.home.playStore}
          locale={locale}
        />
      </div>
      <Footer
        basePath={basePath}
        locale={locale}
        storeName={storeName}
        businessIdentity={businessIdentity}
        showSbc={config.sbc.show_in_storefront}
        sbcSealToken={config.sbc.seal_token}
        showLogo
        tagline={config.footer.tagline}
        copyright={config.footer.copyright}
        contact={config.contact}
        socialLinks={publishedSocialLinks(config)}
        whatsappHref={publishedWhatsAppHref(config, "footer")}
        appLinks={appLinks}
        licenseNumber={config.verification.licenseNumber}
        categoryLinks={
          <li>
            <a href={`${basePath}/c/roses`}>
              {locale === "ar" ? "ورود" : "Roses"}
            </a>
          </li>
        }
      />
      {floating ? (
        <StoreWhatsApp href={floating} label={messages.footer.whatsappAria} />
      ) : null}
    </div>
  );
}
