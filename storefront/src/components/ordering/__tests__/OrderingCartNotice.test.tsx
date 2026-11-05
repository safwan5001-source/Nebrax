import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { OrderingCartNotice } from "@/components/ordering/OrderingCartNotice";
import { OrderingProvider } from "@/contexts/OrderingContext";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { AwjOrdering } from "@/lib/commerce/ordering";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

const ordering = (over: Partial<AwjOrdering> = {}): AwjOrdering => ({
  accepting: true,
  reason: null,
  message: null,
  resumesAt: null,
  minOrderMinor: 15000,
  minOrderScope: "all",
  ...over,
});

const sar = (amount_minor: number) => ({ amount_minor, currency: "SAR" });

function mount(
  locale: "ar" | "en",
  block: AwjOrdering | null,
  props: Parameters<typeof OrderingCartNotice>[0],
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? ar : en}
    >
      <OrderingProvider ordering={block}>
        <OrderingCartNotice {...props} />
      </OrderingProvider>
    </NextIntlClientProvider>,
  );
}

describe("OrderingCartNotice (COPS-H4 Buyer Ordering UX)", () => {
  it("renders nothing when there is no ordering block (gate closed) — the cart is exactly what it was", () => {
    const { container } = mount("en", null, { subtotal: sar(5000) });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the store accepts orders and has no minimum", () => {
    const { container } = mount("en", ordering({ minOrderMinor: null }), {
      subtotal: sar(5000),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the minimum and exactly how much is still missing (English)", () => {
    mount("en", ordering(), { subtotal: sar(12000) });

    // Amounts use the storefront's one money formatter (the cart summary's), so the figures read the same everywhere.
    expect(screen.getByText(/Minimum order:/).textContent).toContain(
      formatMinorAmount(sar(15000)),
    );
    const shortfall = screen.getByText(/Add at least/);
    expect(shortfall.textContent).toContain(formatMinorAmount(sar(3000)));
    expect(shortfall).toHaveAttribute("aria-live", "polite");
    expect(shortfall).toHaveAttribute("data-ordering-shortfall", "3000");
    expect(
      screen.getByText(
        "The store confirms the minimum when you place the order.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the same facts in Arabic", () => {
    mount("ar", ordering(), { subtotal: sar(12000) });

    expect(screen.getByText(/الحد الأدنى للطلب:/)).toBeInTheDocument();
    expect(screen.getByText(/أضف منتجات بقيمة/)).toBeInTheDocument();
    expect(
      screen.getByText("يتحقق المتجر من الحد الأدنى نهائياً عند إتمام الطلب."),
    ).toBeInTheDocument();
  });

  it("says the minimum has been reached once the subtotal meets it", () => {
    mount("en", ordering(), { subtotal: sar(15000) });
    const reached = screen.getByText("Your order has reached the minimum.");
    expect(reached).toHaveAttribute("data-ordering-shortfall", "0");
    expect(screen.queryByText(/Add at least/)).toBeNull();
  });

  it("labels a delivery-only minimum as such on the cart, where the method is not yet known", () => {
    mount("en", ordering({ minOrderScope: "delivery_only" }), {
      subtotal: sar(5000),
    });
    expect(screen.getByText(/Minimum order for delivery:/)).toBeInTheDocument();
    expect(screen.getByText(/Add at least/)).toBeInTheDocument();
  });

  it("tells a pickup shopper the delivery-only minimum does not apply, and shows no shortfall", () => {
    mount("en", ordering({ minOrderScope: "delivery_only" }), {
      subtotal: sar(5000),
      deliveryMethod: "pickup",
    });
    expect(
      screen.getByText("Store pickup is not subject to the minimum."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Add at least/)).toBeNull();
  });

  it("updates the shortfall as the subtotal changes", () => {
    const { rerender } = mount("en", ordering(), { subtotal: sar(1000) });
    expect(screen.getByText(/Add at least/)).toHaveAttribute(
      "data-ordering-shortfall",
      "14000",
    );
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <OrderingProvider ordering={ordering()}>
          <OrderingCartNotice subtotal={sar(14000)} />
        </OrderingProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Add at least/)).toHaveAttribute(
      "data-ordering-shortfall",
      "1000",
    );
  });

  it("warns that new orders cannot be placed while the store is not accepting — even with no minimum", () => {
    mount(
      "en",
      ordering({
        accepting: false,
        reason: "paused",
        minOrderMinor: null,
      }),
      { subtotal: sar(5000) },
    );
    expect(
      screen.getByText(
        /not taking new orders right now\. You can keep your items in the cart/,
      ),
    ).toBeInTheDocument();
  });

  // Server is the single source of truth: this notice is advice and must never be an enforcement point.
  it("is purely informational: no button or link, and nothing that could disable the checkout action", () => {
    mount("en", ordering({ accepting: false, reason: "paused" }), {
      subtotal: sar(1000),
    });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("[disabled]")).toBeNull();
  });
});
