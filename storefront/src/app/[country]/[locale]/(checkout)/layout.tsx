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
 * (`(store-checkout)/checkout`, `/checkout/payment-return`); a Spree cart existed only on the Spree wholesale portal,
 * which linked here (`/checkout/{cart.id}`) and whose payment return URLs were `/confirm-payment/{id}` and
 * `/order-placed/{id}`. That portal's route group has since been removed (H6 W1a), so nothing in the app links here any
 * more: these routes are a plain 404 unless the (unusable — no Spree backend exists) add-on env is set, instead of
 * building a Spree client for a storefront that has none. They are the next removal candidate (R1); until then the
 * check runs in the layout, before any page or data loader, so no Spree call can happen on a 404.
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
