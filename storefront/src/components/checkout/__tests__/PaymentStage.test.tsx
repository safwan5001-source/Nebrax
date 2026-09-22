import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaymentStage } from "@/components/checkout/awj/PaymentStage";
import { PAYMENT_CAPABILITY } from "@/lib/commerce/capabilities";
import type { AwjPaymentMethod } from "@/lib/commerce/checkout-types";

const t = ((key: string) => key) as unknown as Parameters<
  typeof PaymentStage
>[0]["t"];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const cashMethod: AwjPaymentMethod = {
  id: "pm-1",
  name: "نقدي",
  name_en: "Cash",
  settlement_type: "cash",
};

describe("PaymentStage", () => {
  it("declares online/card payment still design_only", () => {
    // COM-MOBILE-PAYMENTS-1 made COD/Pay on Pickup real; card/online remain
    // unbuilt — this constant governs only the card/online piece.
    expect(PAYMENT_CAPABILITY).toBe("design_only");
  });

  it("with no enabled methods, states plainly that none is configured and offers no choice", () => {
    render(
      <PaymentStage
        paymentMethods={[]}
        selectedPaymentMethodId={null}
        onChange={vi.fn()}
        deliveryMethod={null}
        t={t}
      />,
    );

    expect(screen.getByText("payment.noMethodsEnabled")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("with one enabled method, shows it as a real, selectable, pre-checked option", () => {
    render(
      <PaymentStage
        paymentMethods={[cashMethod]}
        selectedPaymentMethodId={cashMethod.id}
        onChange={vi.fn()}
        deliveryMethod="standard"
        t={t}
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(1);
    expect(screen.getByText(cashMethod.name)).toBeInTheDocument();
  });

  it("shows the delivery-derived settlement timing, not an invented price or provider", () => {
    render(
      <PaymentStage
        paymentMethods={[cashMethod]}
        selectedPaymentMethodId={cashMethod.id}
        onChange={vi.fn()}
        deliveryMethod="pickup"
        t={t}
      />,
    );

    expect(screen.getByText("payment.settledOnPickup")).toBeInTheDocument();
    expect(
      screen.queryByText("payment.settledOnDelivery"),
    ).not.toBeInTheDocument();
  });

  it("never collects card data or names a provider, enabled or not", () => {
    const { container, rerender } = render(
      <PaymentStage
        paymentMethods={[]}
        selectedPaymentMethodId={null}
        onChange={vi.fn()}
        deliveryMethod={null}
        t={t}
      />,
    );
    expect(container.querySelectorAll("input[type='text']")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByText(/card/i)).not.toBeInTheDocument();

    rerender(
      <PaymentStage
        paymentMethods={[cashMethod]}
        selectedPaymentMethodId={cashMethod.id}
        onChange={vi.fn()}
        deliveryMethod="standard"
        t={t}
      />,
    );
    expect(container.querySelectorAll("input[type='text']")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByText(/card/i)).not.toBeInTheDocument();
  });
});
