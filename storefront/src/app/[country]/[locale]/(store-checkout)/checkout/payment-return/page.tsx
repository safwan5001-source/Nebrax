"use client";

import { usePathname } from "next/navigation";
import { PaymentReturn } from "@/components/checkout/awj/PaymentReturn";
import { extractBasePath } from "@/lib/utils/path";

/**
 * PAY-H4-05 — where the provider's hosted payment page sends the shopper back.
 * The API builds this address from the store's verified domain plus the fixed
 * path `/checkout/payment-return` (no locale, no order id); the locale proxy
 * adds the country/locale prefix. Static segment, so it wins over the Spree
 * `checkout/[id]` route. Nothing in the query string is trusted — see
 * `PaymentReturn`.
 */
export default function AwjPaymentReturnPage() {
  const basePath = extractBasePath(usePathname());
  return <PaymentReturn basePath={basePath} />;
}
