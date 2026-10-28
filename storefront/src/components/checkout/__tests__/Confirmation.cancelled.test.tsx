import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ar from "../../../../messages/ar.json";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import fr from "../../../../messages/fr.json";
import pl from "../../../../messages/pl.json";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { StorefrontOrder } from "@/lib/commerce/checkout-types";
import { AwjOrderConfirmation } from "../awj/Confirmation";

const catalogs = { ar, de, en, es, fr, pl } as Record<string, unknown>;
const state = vi.hoisted(() => ({ locale: "en" }));

function lookup(locale: string, path: string): string {
  const found = path
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      catalogs[locale],
    );
  if (typeof found !== "string") throw new Error(`missing ${locale}:${path}`);
  return found;
}

vi.mock("next-intl", () => ({
  useLocale: () => state.locale,
  useTranslations:
    (namespace: string) => (key: string, vars?: Record<string, string>) => {
      const raw = lookup(state.locale, `${namespace}.${key}`);
      return raw.replace(/\{(\w+)\}/g, (_, name) => vars?.[name] ?? "");
    },
}));
vi.mock("@/hooks/useCartLineImages", () => ({ useCartLineImages: () => ({}) }));

const money = (n: number) => ({ amount_minor: n, currency: "SAR" });

function order(over: Partial<StorefrontOrder> = {}): StorefrontOrder {
  return {
    id: "o1",
    number: "CORD-1",
    status: "cancelled",
    deliveryMethod: "pickup",
    cancelledAt: "2026-05-03T10:00:00+00:00",
    total: money(12000),
    contact: { name: "Salem", phone: "0501234567", email: null },
    delivery: {
      country: "SA",
      city: "Dammam",
      district: null,
      street: "King Fahd Rd",
      postal_code: null,
      notes: null,
    },
    payment: { method: "cod", status: "cancelled", payment_method_name: null },
    gift: null,
    schedule: null,
    items: [
      {
        productId: "p1",
        productName: "Bouquet",
        unitName: "piece",
        quantity: 1,
        unitPrice: money(12000),
        lineTotal: money(12000),
        personalization: [],
        lineId: null,
        addonOf: null,
      },
    ],
    createdAt: "2026-05-01T00:00:00+00:00",
    ...over,
  };
}

describe("AwjOrderConfirmation — cancelled replay (O3c)", () => {
  for (const locale of ["ar", "en", "de", "es", "fr", "pl"]) {
    it(`${locale}: shows the terminal cancelled state, never the success or commitment copy`, () => {
      state.locale = locale;
      render(<AwjOrderConfirmation order={order()} basePath="/sa/ar" />);

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        lookup(locale, "orders.cancelled.title"),
      );
      const text = document.body.textContent ?? "";
      expect(text).not.toContain(lookup(locale, "awjCheckout.success.heading"));
      expect(text).not.toContain(
        lookup(locale, "awjCheckout.success.notPaidNote"),
      );
      expect(text).toContain(lookup(locale, "orders.cancelled.detail"));
      // Order number and the server's total stay visible.
      expect(text).toContain("CORD-1");
      expect(text.replace(/\s/g, "")).toContain(
        formatMinorAmount(money(12000)).replace(/\s/g, ""),
      );
    });
  }

  it("en: no refund or payment-reversal claim", () => {
    state.locale = "en";
    render(<AwjOrderConfirmation order={order()} basePath="/sa/en" />);
    expect(document.body.textContent ?? "").not.toMatch(
      /refunded|refund (has|was|will|is)/i,
    );
    expect(document.body.textContent ?? "").toContain("Cancelled on");
  });

  it("falls back to the dateless body when cancelledAt is missing", () => {
    state.locale = "en";
    render(
      <AwjOrderConfirmation
        order={order({ cancelledAt: null })}
        basePath="/sa/en"
      />,
    );
    expect(document.body.textContent ?? "").not.toContain("Cancelled on");
    expect(
      screen.getByText(lookup("en", "orders.cancelled.bodyNoDate")),
    ).toBeInTheDocument();
  });

  it("a confirmed order keeps the original success copy", () => {
    state.locale = "en";
    render(
      <AwjOrderConfirmation
        order={order({ status: "confirmed", cancelledAt: undefined })}
        basePath="/sa/en"
      />,
    );
    expect(document.body.textContent ?? "").toContain(
      lookup("en", "awjCheckout.success.notPaidNote"),
    );
    expect(document.body.textContent ?? "").not.toContain(
      lookup("en", "orders.cancelled.title"),
    );
  });
});
