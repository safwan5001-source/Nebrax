import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AwjCheckoutFlow } from "@/components/checkout/AwjCheckoutFlow";

/**
 * STORE-UI-4 — the AWJ-native checkout page.
 *
 * Deliberately outside the `(checkout)` route group: that group's layout wraps
 * its children in the Spree-backed `CheckoutProvider`, which this flow has no
 * use for and must not depend on (see `AwjCheckoutFlow`'s module doc). It now
 * also sits outside `(storefront)`, so it can carry the focused checkout shell
 * described in `(store-checkout)/layout.tsx` instead of the full storefront
 * chrome. The URL is unchanged.
 */
/**
 * Page title only — the store name comes from the shared layout template
 * (`%s | <published store name>`). Robots/canonical rules are unchanged.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "awjCheckout",
  });
  return { title: t("title") };
}

export default function AwjCheckoutPage() {
  return <AwjCheckoutFlow />;
}
