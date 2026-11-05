import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderingProvider } from "@/contexts/OrderingContext";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { StorefrontCheckout } from "@/lib/commerce/checkout-types";
import type { AwjOrdering } from "@/lib/commerce/ordering";
import { AwjCheckoutFlow } from "../AwjCheckoutFlow";

/**
 * COPS-H4 Buyer Ordering UX — the checkout flow's side of the intake rules.
 *
 * The governing rule under test: the server's `POST checkout/complete` is the single source of truth. The notice explains,
 * the refusal carries exact amounts, and nothing on the client ever blocks the "place order" action.
 */

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => {
    const fn = (key: string, vars?: Record<string, unknown>) =>
      vars
        ? `${namespace}.${key}:${JSON.stringify(vars)}`
        : `${namespace}.${key}`;
    fn.has = () => true;
    fn.rich = fn;
    return fn;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/us/en/checkout" }));

const mockActions = vi.hoisted(() => ({
  startOrResumeAwjCheckout: vi.fn(),
  updateAwjContact: vi.fn(),
  updateAwjAddress: vi.fn(),
  updateAwjDelivery: vi.fn(),
  getAwjPaymentMethods: vi.fn(),
  updateAwjPayment: vi.fn(),
  completeAwjCheckoutAction: vi.fn(),
  getAwjDeliverySchedule: vi.fn(),
  updateAwjSchedule: vi.fn(),
  updateAwjGift: vi.fn(),
  getAwjCheckoutIdentity: vi.fn(),
}));
vi.mock("@/lib/data/awj-checkout", () => mockActions);
vi.mock("@/lib/data/awj-online-payment", () => ({
  startOnlinePaymentAction: vi.fn(),
  getOnlinePaymentStatusAction: vi.fn(),
}));

const cart = (subtotalMinor: number) => ({
  kind: "awj" as const,
  items: [
    {
      id: "line-1",
      productId: "prod-1",
      variantId: null,
      variantDescriptor: null,
      name: "Item",
      unitKey: "base",
      unitName: "pc",
      quantity: 1,
      unitPrice: { amount_minor: subtotalMinor, currency: "SAR" },
      lineTotal: { amount_minor: subtotalMinor, currency: "SAR" },
      available: true,
      personalization: [],
      addonOf: null,
      perParentQuantity: null,
    },
  ],
  subtotal: { amount_minor: subtotalMinor, currency: "SAR" },
  currency: "SAR",
  hasUnavailableItems: false,
  itemCount: 1,
});

function checkoutWith(
  subtotalMinor: number,
  extra: Partial<StorefrontCheckout> = {},
): StorefrontCheckout {
  return {
    status: "active",
    contact: { name: null, phone: null, email: null },
    delivery: {
      method: null,
      amount: { amount_minor: 0, currency: "SAR" },
      address: {
        country: null,
        region: null,
        city: null,
        district: null,
        street: null,
        postal_code: null,
        notes: null,
      },
    },
    payment: {
      payment_method_id: null,
      payment_method_name: null,
      method: null,
    },
    gift: null,
    giftOptions: {
      enabled: false,
      messageMaxLength: 250,
      allowHideSender: true,
      recipientPhoneRequired: true,
    },
    schedule: null,
    cart: cart(subtotalMinor),
    ...extra,
  };
}

const ordering = (over: Partial<AwjOrdering> = {}): AwjOrdering => ({
  accepting: true,
  reason: null,
  message: null,
  resumesAt: null,
  minOrderMinor: null,
  minOrderScope: "all",
  ...over,
});

function mount(block: AwjOrdering | null) {
  return render(
    <OrderingProvider ordering={block}>
      <AwjCheckoutFlow />
    </OrderingProvider>,
  );
}

async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText("awjCheckout.contact.name");
  await user.type(screen.getByLabelText("awjCheckout.contact.name"), "Salem");
  await user.type(
    screen.getByLabelText("awjCheckout.contact.phone"),
    "0501234567",
  );
  await user.click(
    screen.getByRole("button", { name: "awjCheckout.continueToAddress" }),
  );
  await screen.findByLabelText("awjCheckout.address.country");
  await user.type(screen.getByLabelText("awjCheckout.address.country"), "SA");
  await user.type(screen.getByLabelText("awjCheckout.address.city"), "Dammam");
  await user.type(
    screen.getByLabelText("awjCheckout.address.street"),
    "King Fahd",
  );
  await user.click(
    screen.getByRole("button", { name: "awjCheckout.continueToDelivery" }),
  );
  await screen.findByText("awjCheckout.delivery.heading");
  await user.click(
    screen.getByLabelText(/awjCheckout\.delivery\.methods\.pickup/),
  );
  await user.click(
    screen.getByRole("button", { name: "awjCheckout.continueToPayment" }),
  );
  await screen.findByText("awjCheckout.payment.noMethodsEnabled");
  await user.click(
    screen.getByRole("button", { name: "awjCheckout.continueToReview" }),
  );
  await screen.findByText("awjCheckout.review.heading");
}

function primeFlow(subtotalMinor: number) {
  const base = checkoutWith(subtotalMinor);
  mockActions.startOrResumeAwjCheckout.mockResolvedValue({
    success: true,
    checkout: base,
  });
  mockActions.updateAwjContact.mockResolvedValue({
    success: true,
    checkout: base,
  });
  mockActions.updateAwjAddress.mockResolvedValue({
    success: true,
    checkout: base,
  });
  mockActions.updateAwjDelivery.mockResolvedValue({
    success: true,
    checkout: checkoutWith(subtotalMinor, {
      delivery: { ...base.delivery, method: "pickup" },
    }),
  });
}

describe("AwjCheckoutFlow ordering notice (COPS-H4 Buyer Ordering UX)", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockActions)) mock.mockReset();
    mockActions.getAwjCheckoutIdentity.mockResolvedValue("identity-a");
    mockActions.getAwjPaymentMethods.mockResolvedValue([]);
    mockActions.getAwjDeliverySchedule.mockResolvedValue(null);
    localStorage.clear();
  });

  it("is unchanged while the gate is closed: no banner, no summary notice", async () => {
    primeFlow(5000);
    mount(null);
    await screen.findByLabelText("awjCheckout.contact.name");
    expect(document.querySelector("[data-ordering-banner]")).toBeNull();
    expect(document.querySelector("[data-ordering-cart-notice]")).toBeNull();
  });

  it("shows the card banner at the top of the flow when the store is not accepting orders", async () => {
    primeFlow(5000);
    mount(ordering({ accepting: false, reason: "outside_hours" }));
    await screen.findByLabelText("awjCheckout.contact.name");
    expect(
      document.querySelector("[data-ordering-banner='outside_hours']"),
    ).not.toBeNull();
  });

  it("shows the minimum in the order summary and drops it for pickup when it is delivery-only", async () => {
    const user = userEvent.setup();
    primeFlow(5000);
    mount(ordering({ minOrderMinor: 15000, minOrderScope: "delivery_only" }));
    await screen.findByLabelText("awjCheckout.contact.name");
    // Before a delivery method is chosen the minimum is shown with its scope and a live shortfall.
    expect(
      document.querySelector("[data-ordering-shortfall='10000']"),
    ).not.toBeNull();

    await walkToReview(user);
    // Pickup chosen ⇒ the delivery-only minimum does not apply to this order.
    expect(document.querySelector("[data-ordering-shortfall]")).toBeNull();
    expect(screen.getByText("ordering.cart.pickupExempt")).toBeInTheDocument();
  });

  // Server is the single source of truth: the client must let the shopper try, and show what the server says.
  it("never blocks 'place order' — a paused store is refused by the server, not by the client", async () => {
    const user = userEvent.setup();
    primeFlow(5000);
    mockActions.completeAwjCheckoutAction.mockResolvedValue({
      success: false,
      kind: "review_required",
      items: [{ item_id: "store", reason: "store_paused" }],
      checkout: checkoutWith(5000),
      message: "المتجر لا يستقبل طلبات جديدة حالياً.",
    });
    mount(ordering({ accepting: false, reason: "paused" }));
    await walkToReview(user);

    const place = screen.getByRole("button", {
      name: "awjCheckout.completeOrder",
    });
    expect(place).toBeEnabled();
    await user.click(place);

    expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1);
    await screen.findByText("awjCheckout.reviewRequired.title");
    expect(
      screen.getByText("awjCheckout.reviewRequired.reasons.store_paused"),
    ).toBeInTheDocument();
  });

  it("does not block 'place order' below the minimum either, and prints the server's exact amounts on refusal", async () => {
    const user = userEvent.setup();
    primeFlow(5000);
    mockActions.completeAwjCheckoutAction.mockResolvedValue({
      success: false,
      kind: "review_required",
      items: [
        {
          item_id: "store",
          reason: "below_minimum_order",
          min_order_minor: 15000,
          shortfall_minor: 10000,
        },
      ],
      checkout: checkoutWith(5000),
      message: "لم يبلغ طلبك الحدّ الأدنى للطلب.",
    });
    mount(ordering({ minOrderMinor: 15000 }));
    await walkToReview(user);

    const place = screen.getByRole("button", {
      name: "awjCheckout.completeOrder",
    });
    expect(place).toBeEnabled();
    await user.click(place);

    // The server's own figures (not the client's estimate), formatted by the storefront's one money formatter. Compared on
    // raw textContent: the formatted amounts contain non-breaking spaces that Testing Library's text normaliser collapses.
    const minimum = formatMinorAmount({ amount_minor: 15000, currency: "SAR" });
    const shortfall = formatMinorAmount({
      amount_minor: 10000,
      currency: "SAR",
    });
    const alert = await screen.findByRole("alert");
    const line = Array.from(alert.querySelectorAll("li")).map(
      (li) => li.textContent ?? "",
    );
    expect(
      line.some(
        (text) =>
          text.includes("awjCheckout.reviewRequired.belowMinimumWithAmounts") &&
          text.includes(JSON.stringify(minimum).slice(1, -1)) &&
          text.includes(JSON.stringify(shortfall).slice(1, -1)),
      ),
    ).toBe(true);
    expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1);
  });

  it("falls back to the coded reason when a refusal carries no usable amounts", async () => {
    const user = userEvent.setup();
    primeFlow(5000);
    mockActions.completeAwjCheckoutAction.mockResolvedValue({
      success: false,
      kind: "review_required",
      items: [
        {
          item_id: "store",
          reason: "below_minimum_order",
          shortfall_minor: "ten",
        },
      ],
      checkout: checkoutWith(5000),
      message: "x",
    });
    mount(null);
    await walkToReview(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "awjCheckout.reviewRequired.reasons.below_minimum_order",
        ),
      ).toBeInTheDocument(),
    );
  });
});
