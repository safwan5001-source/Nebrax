import { getTranslations } from "next-intl/server";
import { AwjCheckoutFlow } from "@/components/checkout/AwjCheckoutFlow";

/**
 * COM-CHECKOUT-1C — AWJ-native checkout page. Deliberately outside the
 * `(checkout)` route group (that group's `layout.tsx` wraps children in the
 * Spree-backed `CheckoutProvider`, which this flow has no use for and must
 * not depend on — see `AwjCheckoutFlow`'s module doc). Sits in `(storefront)`
 * next to `cart/page.tsx`, sharing the same site header/footer chrome.
 */
export default async function AwjCheckoutPage() {
  const t = await getTranslations("awjCheckout");
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">{t("title")}</h1>
      <AwjCheckoutFlow />
    </div>
  );
}
