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
 */
export default function CheckoutLayout({ children }: CheckoutLayoutProps) {
  if (!isWholesaleEnabled()) notFound();

  return <CheckoutShell>{children}</CheckoutShell>;
}
