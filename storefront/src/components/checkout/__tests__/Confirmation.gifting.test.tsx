import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontOrder } from "@/lib/commerce/checkout-types";
import { AwjOrderConfirmation } from "../awj/Confirmation";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));
vi.mock("@/hooks/useCartLineImages", () => ({ useCartLineImages: () => ({}) }));

const money = (n: number) => ({ amount_minor: n, currency: "SAR" });

function order(over: Partial<StorefrontOrder> = {}): StorefrontOrder {
  return {
    id: "o1",
    number: "CORD-1",
    status: "confirmed",
    deliveryMethod: "standard",
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
    payment: {
      method: "cod",
      status: "awaiting_collection",
      payment_method_name: null,
    },
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
        personalization: [
          {
            key: "card",
            label: "Card",
            labelEn: null,
            display: "Happy birthday",
          },
        ],
        lineId: "l1",
        addonOf: null,
      },
      {
        productId: "a1",
        productName: "Chocolates",
        unitName: null,
        quantity: 1,
        unitPrice: money(0),
        lineTotal: money(0),
        personalization: [],
        lineId: "l2",
        addonOf: "l1",
      },
    ],
    createdAt: null,
    ...over,
  };
}

describe("order confirmation — gift and schedule (FLOWERS-H12b)", () => {
  it("shows nothing extra for an ordinary order", () => {
    render(<AwjOrderConfirmation order={order()} basePath="/sa/en" />);
    expect(
      screen.queryByText("awjCheckout.success.scheduleHeading"),
    ).toBeNull();
    expect(screen.queryByText("awjCheckout.success.giftHeading")).toBeNull();
  });

  it("shows the requested date and window, labelled as requested rather than promised", () => {
    render(
      <AwjOrderConfirmation
        order={order({
          schedule: {
            method: "delivery",
            date: "2099-10-05",
            timezone: "Asia/Riyadh",
            slot: {
              label: "مساءً",
              labelEn: "Evening",
              startTime: "17:00",
              endTime: "21:00",
            },
          },
        })}
        basePath="/sa/en"
      />,
    );
    expect(
      screen.getByText("awjCheckout.success.scheduleHeading"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Evening/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Tuesday|Monday|Wednesday|Thursday|Friday|Saturday|Sunday/,
      ),
    ).toBeInTheDocument();
  });

  it("shows the gift recipient, the displayed sender (or anonymous) and the card message", () => {
    const { unmount } = render(
      <AwjOrderConfirmation
        order={order({
          gift: {
            recipientName: "Mona",
            recipientPhone: null,
            senderDisplayName: "Sara",
            hideSender: false,
            message: "Happy birthday",
          },
        })}
        basePath="/sa/en"
      />,
    );
    expect(screen.getByText(/Mona/)).toBeInTheDocument();
    expect(screen.getByText(/Sara/)).toBeInTheDocument();
    expect(screen.getAllByText(/Happy birthday/).length).toBeGreaterThan(0);
    unmount();
    render(
      <AwjOrderConfirmation
        order={order({
          gift: {
            recipientName: "Mona",
            recipientPhone: null,
            senderDisplayName: "Sara",
            hideSender: true,
            message: null,
          },
        })}
        basePath="/sa/en"
      />,
    );
    expect(
      screen.getByText(/awjCheckout\.review\.giftAnonymous/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Sara/)).toBeNull();
  });

  it("shows personalization on the line and nests the add-on under its parent", () => {
    render(<AwjOrderConfirmation order={order()} basePath="/sa/en" />);
    expect(screen.getByText("Happy birthday")).toBeInTheDocument();
    const lines = screen.getAllByTestId("cart-line");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toHaveAttribute("data-addon", "true");
  });
});
