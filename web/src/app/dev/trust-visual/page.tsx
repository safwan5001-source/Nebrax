"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useLayoutEffect } from "react";
import { StorefrontPreviewCanvas } from "@/modules/store-experience-builder/StorefrontPreviewCanvas";
import { normalizePresentationConfig } from "@/modules/store-experience-builder/presentation/config";

/**
 * Development-only fixture for the merchant preview canvas.
 * Mounts the same StorefrontPreviewCanvas as /commerce/appearance, with
 * click-to-edit handlers on. Not the authenticated production route.
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

function scenarioOf(value: string | null): Scenario {
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

function viewportOf(value: string | null): "mobile" | "tablet" | "desktop" {
  if (value === "mobile" || value === "tablet" || value === "desktop") {
    return value;
  }
  return "desktop";
}

function trustConfig(locale: "ar" | "en", scenario: Scenario) {
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
              androidUrl: "https://play.google.com/store/apps/details?id=sa.awj",
              show: true,
            }
          : {
              iosUrl: "https://apps.apple.com/app/id000000000",
              androidUrl: "https://play.google.com/store/apps/details?id=sa.awj",
              show: true,
            };
  const whatsappOn =
    scenario === "full" ||
    scenario === "long" ||
    scenario === "partial" ||
    scenario === "missing-identity" ||
    scenario === "unsafe";
  return {
    storeName,
    businessIdentity,
    config: normalizePresentationConfig({
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
    }),
  };
}

function DirectionLock({ locale }: { locale: "ar" | "en" }) {
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  return null;
}

function Fixture() {
  const params = useSearchParams();
  const locale = params.get("locale") === "en" ? "en" : "ar";
  const scenario = scenarioOf(params.get("scenario"));
  const viewport = viewportOf(params.get("viewport"));
  const trust = trustConfig(locale, scenario);

  return (
    <main
      data-trust-surface="merchant-preview"
      data-scenario={scenario}
      data-locale={locale}
    >
      <DirectionLock locale={locale} />
      <StorefrontPreviewCanvas
        config={trust.config}
        locale={locale}
        viewport={viewport}
        liveStoreName={trust.storeName}
        businessIdentity={trust.businessIdentity}
        onSelectSection={() => {}}
        onSelectChrome={() => {}}
      />
    </main>
  );
}

export default function TrustVisualPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <Suspense>
      <Fixture />
    </Suspense>
  );
}
