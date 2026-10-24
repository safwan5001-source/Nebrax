import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentReturn } from "@/components/checkout/awj/PaymentReturn";
import type { AwjOnlinePayment } from "@/lib/commerce/online-payment";
import { savePendingOnlinePayment } from "@/lib/commerce/pending-online-payment";
import ar from "../../../../messages/ar.json";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import fr from "../../../../messages/fr.json";
import pl from "../../../../messages/pl.json";

/**
 * PAY-H4-05 — the return page in all six shipped languages, rendered with the
 * **real** message files (not key echoes): every state's title is the
 * translated string, no `{amount}` placeholder or raw key leaks through, and
 * the amount actually appears in the sentences that carry it. The AWJ market
 * exposes only `ar`/`en` routes, so this is how de/es/fr/pl are verified.
 */
const LOCALES = { ar, de, en, es, fr, pl } as const;

const status = vi.fn();
vi.mock("@/lib/data/awj-online-payment", () => ({
  getOnlinePaymentStatusAction: (...args: unknown[]) => status(...args),
  startOnlinePaymentAction: vi.fn(),
}));

const base: AwjOnlinePayment = {
  status: "paid",
  can_retry: false,
  amount: { amount_minor: 18750, currency: "SAR" },
  paid_at: null,
  expires_at: null,
  checkout_url: null,
};

const CASES = [
  ["paid", { status: "paid" }, "paidTitle", "paidBody"],
  ["under_review", { status: "under_review" }, "reviewTitle", "reviewBody"],
  ["pending", { status: "pending" }, "pendingTitle", "pendingBody"],
  [
    "awaiting_payment",
    { status: "awaiting_payment", can_retry: true },
    "awaitingTitle",
    "awaitingBody",
  ],
  [
    "failed",
    { status: "failed", can_retry: true },
    "failedTitle",
    "failedBody",
  ],
  [
    "expired",
    { status: "expired", can_retry: true },
    "expiredTitle",
    "expiredBody",
  ],
  ["cancelled", { status: "cancelled" }, "cancelledTitle", "cancelledBody"],
] as const;

describe("PaymentReturn in every shipped language", () => {
  beforeEach(() => {
    window.localStorage.clear();
    status.mockReset();
    savePendingOnlinePayment({
      orderId: "o-1",
      orderReference: "ref-1",
      orderNumber: null,
    });
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    for (const [name, over, titleKey, bodyKey] of CASES) {
      it(`${locale} · ${name}`, async () => {
        status.mockResolvedValue({
          success: true,
          payment: { ...base, ...over },
        });
        const copy = (
          messages.awjCheckout.paymentReturn as Record<string, string>
        )[titleKey];
        render(
          <NextIntlClientProvider locale={locale} messages={messages}>
            <PaymentReturn basePath={`/sa/${locale}`} />
          </NextIntlClientProvider>,
        );

        const heading = await screen.findByRole("heading", {
          level: 1,
          name: copy,
        });
        expect(heading).toBeInTheDocument();
        const card = screen.getByTestId("awj-payment-return");
        expect(card.textContent).not.toMatch(/\{|\}|awjCheckout\./);
        const body = (
          messages.awjCheckout.paymentReturn as Record<string, string>
        )[bodyKey];
        if (body.includes("{amount}")) {
          // the formatted amount (digits) is rendered inside the sentence
          expect(card.textContent).toMatch(/[0-9٠-٩]{2,}/);
          expect(card.textContent).not.toMatch(/\.\.$/m);
        }
      });
    }
  }
});
