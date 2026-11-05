import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { OrderingBanner } from "@/components/ordering/OrderingBanner";
import { OrderingCartNotice } from "@/components/ordering/OrderingCartNotice";
import { OrderingProvider } from "@/contexts/OrderingContext";
import type { AwjOrdering } from "@/lib/commerce/ordering";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

/**
 * COPS-H4 Buyer Ordering UX — development-only visual fixture. Mounts the REAL `OrderingBanner` and `OrderingCartNotice`
 * (the same components the storefront layout, cart and checkout render) against fixed ordering blocks, with no backend.
 * Production requests 404. `?scenario=` paused | paused-note | outside-hours | cart-min | cart-pickup | cart-paused |
 * accepting · `?locale=ar|en`.
 */

type Scenario =
  | "paused"
  | "paused-note"
  | "outside-hours"
  | "cart-min"
  | "cart-pickup"
  | "cart-paused"
  | "accepting";

const BASE: AwjOrdering = {
  accepting: true,
  reason: null,
  message: null,
  resumesAt: null,
  minOrderMinor: null,
  minOrderScope: "all",
};

const SCENARIOS: Record<Scenario, AwjOrdering> = {
  paused: { ...BASE, accepting: false, reason: "paused" },
  "paused-note": {
    ...BASE,
    accepting: false,
    reason: "paused",
    message: "نغلق اليوم للصيانة · Closed today for maintenance",
    resumesAt: "2026-11-09T14:00:00+00:00",
  },
  "outside-hours": { ...BASE, accepting: false, reason: "outside_hours" },
  "cart-min": { ...BASE, minOrderMinor: 15000 },
  "cart-pickup": {
    ...BASE,
    minOrderMinor: 15000,
    minOrderScope: "delivery_only",
  },
  "cart-paused": {
    ...BASE,
    accepting: false,
    reason: "paused",
    minOrderMinor: 15000,
  },
  accepting: BASE,
};

const SUBTOTAL = { amount_minor: 12000, currency: "SAR" } as const;

export default async function OrderingVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; locale?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ar";
  const scenario: Scenario =
    params.scenario && params.scenario in SCENARIOS
      ? (params.scenario as Scenario)
      : "paused";
  const ordering = SCENARIOS[scenario];
  const showBanner = !ordering.accepting;

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? ar : en}
    >
      <div
        dir={locale === "ar" ? "rtl" : "ltr"}
        lang={locale}
        data-scenario={scenario}
        className="min-h-dvh bg-store-background text-store-foreground"
      >
        <header className="border-b border-store-border bg-store-surface p-4 text-lg font-semibold">
          Al Noor
        </header>
        {showBanner ? <OrderingBanner ordering={ordering} /> : null}
        <main className="mx-auto w-full max-w-store space-y-4 px-4 py-6 sm:px-6 lg:px-8">
          <OrderingProvider ordering={ordering}>
            <section
              aria-label="cart-summary"
              className="max-w-sm space-y-3 rounded-store border border-store-border bg-store-surface p-4"
            >
              <OrderingCartNotice
                subtotal={SUBTOTAL}
                deliveryMethod={scenario === "cart-pickup" ? "pickup" : null}
              />
              <a
                href="#checkout"
                data-testid="checkout-cta"
                className="block rounded-store bg-store-primary px-4 py-3 text-center font-semibold text-store-primary-foreground"
              >
                {locale === "ar" ? "إتمام الطلب" : "Proceed to checkout"}
              </a>
            </section>
          </OrderingProvider>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
