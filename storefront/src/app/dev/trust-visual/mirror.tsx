"use client";

import { StorefrontPreviewCanvas } from "@/components/customizer/StorefrontPreviewCanvas";
import type { StorefrontPresentationConfig } from "@/lib/presentation";

/**
 * The storefront customizer mirror. Not the merchant editor. It does not
 * receive click-to-edit handlers.
 */
export function TrustMirror({
  config,
  locale,
  viewport,
  storeName,
  businessIdentity,
}: {
  config: StorefrontPresentationConfig;
  locale: "ar" | "en";
  viewport: "desktop" | "tablet" | "mobile";
  storeName: string;
  businessIdentity: {
    legal_name: string | null;
    cr_number: string | null;
    vat_number: string | null;
  };
}) {
  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      data-trust-surface="mirror"
      data-locale={locale}
    >
      <StorefrontPreviewCanvas
        config={config}
        locale={locale}
        viewport={viewport}
        liveStoreName={storeName}
        businessIdentity={businessIdentity}
      />
    </div>
  );
}
