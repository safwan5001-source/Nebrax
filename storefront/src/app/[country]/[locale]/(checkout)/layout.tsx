import { notFound } from "next/navigation";
import { isWholesaleEnabled } from "@/lib/spree";
import { CheckoutShell } from "./CheckoutShell";

interface CheckoutLayoutProps {
  children: React.ReactNode;
}

/**
 * X5 — gate for the legacy, Spree-backed checkout routes in this group:
 * `checkout/[id]`, `confirm-payment/[id]` and `order-placed/[id]`.
 *
 * Ownership (evidence, not assumption): the DTC storefront's cart and checkout are AWJ-native
 * (`(store-checkout)/checkout`, `/checkout/payment-return`); a Spree cart exists only on the opt-in wholesale
 * surface, which links here (`WholesaleCartView` → `/checkout/{cart.id}`) and whose payment return URLs are
 * `/confirm-payment/{id}` and `/order-placed/{id}`. So these routes are the wholesale add-on's: they work exactly as
 * before when wholesale is enabled — the same condition `(wholesale)/wholesale/layout.tsx` uses — and are a plain
 * 404 otherwise, instead of building a Spree client for a storefront that has none. The check runs in the layout,
 * before any page or data loader, so no Spree call can happen on a 404.
 *
 * X5b — this gate alone cannot set the HTTP status: with `cacheComponents` the shell is streamed, so a `notFound()`
 * here renders the 404 page under an already-committed 200. The real 404 is issued by the proxy
 * (`createSpreeMiddleware` → `legacyCheckoutClosed`) before rendering. This layout stays as defence in depth for
 * requests the proxy matcher skips (e.g. ids containing a dot), where it still renders the 404 page and loads nothing.
 */
export default function CheckoutLayout({ children }: CheckoutLayoutProps) {
  if (!isWholesaleEnabled()) notFound();

  return <CheckoutShell>{children}</CheckoutShell>;
}
