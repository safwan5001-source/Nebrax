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
  it("declares online/card payment gated: built, but withheld until the server opens it", () => {
    // COM-MOBILE-PAYMENTS-1 made COD/Pay on Pickup real; PAY-H4-05 built the
    // online journey behind the server's own gate (the API marks a method
    // `online` only when it is open) — this constant governs that piece.
    expect(PAYMENT_CAPABILITY).toBe("gated");
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

  it("marks an online method with its hint and, once selected, replaces the cash note with the redirect note", () => {
    const online: AwjPaymentMethod = {
      ...cashMethod,
      id: "pm-2",
      name: "بطاقة",
      name_en: "Card",
      settlement_type: "bank",
      online: true,
    };
    const { rerender } = render(
      <PaymentStage
        paymentMethods={[cashMethod, online]}
        selectedPaymentMethodId={cashMethod.id}
        onChange={vi.fn()}
        deliveryMethod="standard"
        t={t}
      />,
    );
    expect(screen.getByText("payment.onlineMethodHint")).toBeInTheDocument();
    expect(screen.getByText("payment.settledOnDelivery")).toBeInTheDocument();
    expect(screen.queryByTestId("awj-payment-online-note")).toBeNull();

    rerender(
      <PaymentStage
        paymentMethods={[cashMethod, online]}
        selectedPaymentMethodId={online.id}
        onChange={vi.fn()}
        deliveryMethod="standard"
        t={t}
      />,
    );
    expect(screen.getByTestId("awj-payment-online-note")).toHaveTextContent(
      "payment.onlineRedirectNote",
    );
    expect(screen.queryByText("payment.settledOnDelivery")).toBeNull();
  });

  it("Beta: lists merchant-enabled online methods through the message catalogue, ready or not, with the redirect note once chosen", () => {
    const ready: AwjPaymentMethod = {
      id: "online:mada",
      name: "mada",
      name_en: null,
      settlement_type: "online",
      online: true,
      onlineKey: "mada",
      ready: true,
      linkedMethodId: "pm-9",
    };
    const notReady: AwjPaymentMethod = {
      ...ready,
      id: "online:visa",
      name: "visa",
      onlineKey: "visa",
      ready: false,
      linkedMethodId: null,
    };
    const onChange = vi.fn();
    const { rerender } = render(
      <PaymentStage
        paymentMethods={[cashMethod, ready, notReady]}
        selectedPaymentMethodId={cashMethod.id}
        onChange={onChange}
        deliveryMethod="standard"
        t={t}
      />,
    );

    // الاسم من الكتالوج بمفتاح الخادم، لا من نص مكتوب في المكوّن؛ وغير الجاهزة تُعرض طبيعياً (الرفض عند المتابعة لا بملصق مسبق)
    expect(screen.getByText("payment.onlineBrand.mada")).toBeInTheDocument();
    expect(screen.getByText("payment.onlineBrand.visa")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByTestId("awj-payment-online-note")).toBeNull();

    rerender(
      <PaymentStage
        paymentMethods={[cashMethod, ready, notReady]}
        selectedPaymentMethodId="online:visa"
        onChange={onChange}
        deliveryMethod="standard"
        t={t}
      />,
    );
    // غير جاهزة: لا رسالة تحويل لصفحة المزوّد، بل إشعار «غير متاح»
    expect(screen.queryByTestId("awj-payment-online-note")).toBeNull();
    expect(
      screen.getByTestId("awj-payment-unavailable-note"),
    ).toBeInTheDocument();

    rerender(
      <PaymentStage
        paymentMethods={[cashMethod, ready, notReady]}
        selectedPaymentMethodId="online:mada"
        onChange={onChange}
        deliveryMethod="standard"
        t={t}
      />,
    );
    expect(screen.getByTestId("awj-payment-online-note")).toBeInTheDocument();
  });

  it("shows the approved brand mark for known online keys, the generic icon otherwise, and no mark for cash", () => {
    const mk = (key: string, ready = true): AwjPaymentMethod => ({
      id: `online:${key}`,
      name: key,
      name_en: null,
      settlement_type: "online",
      online: true,
      onlineKey: key,
      ready,
      linkedMethodId: ready ? "pm-9" : null,
    });
    const { container } = render(
      <PaymentStage
        paymentMethods={[
          cashMethod,
          mk("mada"),
          mk("visa"),
          mk("mastercard"),
          mk("apple_pay", false),
          mk("unknown_scheme"),
        ]}
        selectedPaymentMethodId={cashMethod.id}
        onChange={vi.fn()}
        deliveryMethod="standard"
        t={t}
      />,
    );
    const marks = [...container.querySelectorAll("[data-payment-brand]")];
    expect(marks.map((m) => m.getAttribute("data-payment-brand"))).toEqual([
      "mada",
      "visa",
      "mastercard",
      "apple_pay",
    ]);
    for (const img of container.querySelectorAll("[data-payment-brand] img")) {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("src")).toMatch(/^\/payment-brands\/.+\.svg$/);
    }
    expect(container.querySelectorAll("svg.lucide-credit-card")).toHaveLength(
      1,
    );
  });

  it("does not show the provider-redirect note or hint for a not-ready method; shows the unavailable notice instead", () => {
    const notReady: AwjPaymentMethod = {
      id: "online:apple_pay",
      name: "apple_pay",
      name_en: null,
      settlement_type: "online",
      online: true,
      onlineKey: "apple_pay",
      ready: false,
      linkedMethodId: null,
    };
    render(
      <PaymentStage
        paymentMethods={[cashMethod, notReady]}
        selectedPaymentMethodId={notReady.id}
        onChange={vi.fn()}
        deliveryMethod="standard"
        t={t}
      />,
    );
    expect(screen.queryByTestId("awj-payment-online-note")).toBeNull();
    expect(screen.queryByText("payment.onlineRedirectNote")).toBeNull();
    expect(screen.queryByText("payment.onlineMethodHint")).toBeNull();
    expect(screen.queryByText("payment.settledOnDelivery")).toBeNull();
    expect(
      screen.getByTestId("awj-payment-unavailable-note"),
    ).toHaveTextContent("payment.onlineUnavailable");
  });
});
