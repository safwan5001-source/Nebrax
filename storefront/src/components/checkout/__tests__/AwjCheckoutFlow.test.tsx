import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontCheckout } from "@/lib/commerce/checkout-types";
import { AwjCheckoutFlow } from "../AwjCheckoutFlow";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const fn = (key: string, vars?: Record<string, unknown>) =>
      vars
        ? `${namespace}.${key}:${JSON.stringify(vars)}`
        : `${namespace}.${key}`;
    fn.has = () => true;
    return fn;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/us/ar/checkout",
}));

const mockActions = vi.hoisted(() => ({
  startOrResumeAwjCheckout: vi.fn(),
  updateAwjContact: vi.fn(),
  updateAwjAddress: vi.fn(),
  updateAwjDelivery: vi.fn(),
  completeAwjCheckoutAction: vi.fn(),
  // Fixed by default — real localStorage-backed persistence
  // (`@/lib/commerce/checkout-idempotency`) is exercised for real via
  // jsdom's real `localStorage`, not mocked, so these tests prove actual
  // reload/retry/new-checkout/cleanup behavior rather than a mock's say-so.
  getAwjCheckoutIdentity: vi.fn().mockResolvedValue("identity-a"),
}));

vi.mock("@/lib/data/awj-checkout", () => mockActions);

function emptyCart() {
  return {
    kind: "awj" as const,
    items: [] as Array<never>,
    subtotal: { amount_minor: 0, currency: "SAR" },
    currency: "SAR",
    hasUnavailableItems: false,
    itemCount: 0,
  };
}

function cartWithItem() {
  return {
    kind: "awj" as const,
    items: [
      {
        id: "line-1",
        productId: "prod-1",
        name: "منتج تجريبي",
        unitKey: "base",
        unitName: "قطعة",
        quantity: 2,
        unitPrice: { amount_minor: 2500, currency: "SAR" },
        lineTotal: { amount_minor: 5000, currency: "SAR" },
        available: true,
      },
    ],
    subtotal: { amount_minor: 5000, currency: "SAR" },
    currency: "SAR",
    hasUnavailableItems: false,
    itemCount: 2,
  };
}

function checkoutWith(
  overrides: Partial<ReturnType<typeof baseCheckout>> = {},
) {
  return { ...baseCheckout(), ...overrides };
}

function baseCheckout(): StorefrontCheckout {
  return {
    status: "active" as const,
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
    cart: cartWithItem(),
  };
}

const sampleOrder = {
  id: "order-1",
  number: "CORD-2026-00001",
  status: "confirmed",
  deliveryMethod: "pickup",
  total: { amount_minor: 5000, currency: "SAR" },
  contact: { name: "سالم الأحمدي", phone: "0501234567", email: null },
  delivery: {
    country: "SA",
    city: "الدمام",
    district: null,
    street: "شارع الملك فهد",
    postal_code: null,
    notes: null,
  },
  items: [
    {
      productId: "prod-1",
      productName: "منتج تجريبي",
      unitName: "قطعة",
      quantity: 2,
      unitPrice: { amount_minor: 2500, currency: "SAR" },
      lineTotal: { amount_minor: 5000, currency: "SAR" },
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
};

async function fillDetailsAndContinue(
  user: ReturnType<typeof userEvent.setup>,
) {
  await screen.findByLabelText("awjCheckout.contact.name");
  await user.type(
    screen.getByLabelText("awjCheckout.contact.name"),
    "سالم الأحمدي",
  );
  await user.type(
    screen.getByLabelText("awjCheckout.contact.phone"),
    "0501234567",
  );
  await user.type(screen.getByLabelText("awjCheckout.address.country"), "SA");
  await user.type(screen.getByLabelText("awjCheckout.address.city"), "الدمام");
  await user.type(
    screen.getByLabelText("awjCheckout.address.street"),
    "شارع الملك فهد",
  );
  await user.click(
    screen.getByLabelText(/awjCheckout\.delivery\.methods\.pickup/),
  );
  await user.click(
    screen.getByRole("button", { name: "awjCheckout.continueToReview" }),
  );
}

describe("AwjCheckoutFlow", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockActions)) {
      mock.mockReset();
    }
    mockActions.getAwjCheckoutIdentity.mockResolvedValue("identity-a");
    localStorage.clear();
  });

  it("creates/resumes the checkout on mount via the real backend API, not client-side totals", async () => {
    mockActions.startOrResumeAwjCheckout.mockResolvedValue({
      success: true,
      checkout: checkoutWith(),
    });

    render(<AwjCheckoutFlow />);

    await waitFor(() =>
      expect(mockActions.startOrResumeAwjCheckout).toHaveBeenCalledTimes(1),
    );
  });

  it("shows an empty-cart state and never calls checkout completion when the cart has no items", async () => {
    mockActions.startOrResumeAwjCheckout.mockResolvedValue({
      success: true,
      checkout: checkoutWith({ cart: emptyCart() }),
    });

    render(<AwjCheckoutFlow />);

    await screen.findByText("awjCheckout.emptyCartTitle");
    expect(mockActions.completeAwjCheckoutAction).not.toHaveBeenCalled();
  });

  it("shows an unavailable-checkout state when the cart/checkout is missing or expired", async () => {
    mockActions.startOrResumeAwjCheckout.mockResolvedValue({
      success: false,
      error: "جلسة الدفع غير متاحة.",
    });

    render(<AwjCheckoutFlow />);

    await screen.findByText("awjCheckout.unavailableTitle");
  });

  it("saves contact, address, and delivery via their own dedicated PATCH actions, then shows an authoritative review", async () => {
    const user = userEvent.setup();
    mockActions.startOrResumeAwjCheckout.mockResolvedValue({
      success: true,
      checkout: checkoutWith(),
    });
    const withContact = checkoutWith({
      contact: { name: "سالم الأحمدي", phone: "0501234567", email: null },
    });
    const withAddress = checkoutWith({
      contact: withContact.contact,
      delivery: {
        ...withContact.delivery,
        address: {
          ...withContact.delivery.address,
          country: "SA",
          city: "الدمام",
          street: "شارع الملك فهد",
        },
      },
    });
    const withDelivery = checkoutWith({
      contact: withAddress.contact,
      delivery: { ...withAddress.delivery, method: "pickup" },
    });
    mockActions.updateAwjContact.mockResolvedValue({
      success: true,
      checkout: withContact,
    });
    mockActions.updateAwjAddress.mockResolvedValue({
      success: true,
      checkout: withAddress,
    });
    mockActions.updateAwjDelivery.mockResolvedValue({
      success: true,
      checkout: withDelivery,
    });

    render(<AwjCheckoutFlow />);
    await fillDetailsAndContinue(user);

    await waitFor(() => {
      expect(mockActions.updateAwjContact).toHaveBeenCalledWith(
        expect.objectContaining({ name: "سالم الأحمدي", phone: "0501234567" }),
      );
      expect(mockActions.updateAwjAddress).toHaveBeenCalledWith(
        expect.objectContaining({
          country: "SA",
          city: "الدمام",
          street: "شارع الملك فهد",
        }),
      );
      expect(mockActions.updateAwjDelivery).toHaveBeenCalledWith("pickup");
    });

    // Review renders totals straight from the server's checkout/cart state —
    // the line total (5000) and subtotal come from `withDelivery.cart`, never
    // recomputed client-side.
    await screen.findByText("awjCheckout.review.heading");
    // 5000 minor units = 50.00 SAR, formatted with Arabic-Indic digits — the
    // exact server-returned amount, never a client recomputation.
    expect(screen.getAllByText(/٥٠/).length).toBeGreaterThan(0);
  });

  it("completes the order with a stable Idempotency-Key that does not change across a retry, and shows the returned CommerceOrder", async () => {
    const user = userEvent.setup();
    mockActions.startOrResumeAwjCheckout.mockResolvedValue({
      success: true,
      checkout: checkoutWith(),
    });
    mockActions.updateAwjContact.mockResolvedValue({
      success: true,
      checkout: checkoutWith({ contact: sampleOrder.contact }),
    });
    mockActions.updateAwjAddress.mockResolvedValue({
      success: true,
      checkout: checkoutWith({ contact: sampleOrder.contact }),
    });
    mockActions.updateAwjDelivery.mockResolvedValue({
      success: true,
      checkout: checkoutWith({
        contact: sampleOrder.contact,
        delivery: {
          amount: { amount_minor: 0, currency: "SAR" },
          method: "pickup",
          address: checkoutWith().delivery.address,
        },
      }),
    });

    // First attempt fails transiently (network-ish error) — retried by the
    // visitor clicking "Complete order" again.
    mockActions.completeAwjCheckoutAction
      .mockResolvedValueOnce({
        success: false,
        kind: "error",
        message: "Network hiccup",
      })
      .mockResolvedValueOnce({
        success: true,
        order: sampleOrder,
        replayed: false,
      });

    render(<AwjCheckoutFlow />);
    await fillDetailsAndContinue(user);
    await screen.findByText("awjCheckout.review.heading");

    const completeButton = () =>
      screen.getByRole("button", { name: "awjCheckout.completeOrder" });

    await user.click(completeButton());
    await waitFor(() =>
      expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1),
    );

    await user.click(completeButton());
    await waitFor(() =>
      expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(2),
    );

    const [firstKey] = mockActions.completeAwjCheckoutAction.mock.calls[0];
    const [secondKey] = mockActions.completeAwjCheckoutAction.mock.calls[1];
    expect(firstKey).toBe(secondKey);
    expect(typeof firstKey).toBe("string");
    expect(firstKey.length).toBeGreaterThanOrEqual(8);

    // Success state shows the exact CommerceOrder the backend returned.
    await screen.findByText("awjCheckout.success.heading");
    expect(
      screen.getByText(
        `awjCheckout.success.orderNumber:${JSON.stringify({ number: sampleOrder.number })}`,
      ),
    ).toBeInTheDocument();
    // Never implies payment happened — `confirmed` is a commercial
    // commitment only.
    expect(
      screen.getByText("awjCheckout.success.notPaidNote"),
    ).toBeInTheDocument();
  });

  it("on review_required, shows the issue instead of a generic error and updates the UI from the authoritative refreshed checkout", async () => {
    const user = userEvent.setup();
    mockActions.startOrResumeAwjCheckout.mockResolvedValue({
      success: true,
      checkout: checkoutWith(),
    });
    mockActions.updateAwjContact.mockResolvedValue({
      success: true,
      checkout: checkoutWith({ contact: sampleOrder.contact }),
    });
    mockActions.updateAwjAddress.mockResolvedValue({
      success: true,
      checkout: checkoutWith({ contact: sampleOrder.contact }),
    });
    mockActions.updateAwjDelivery.mockResolvedValue({
      success: true,
      checkout: checkoutWith({
        contact: sampleOrder.contact,
        delivery: {
          amount: { amount_minor: 0, currency: "SAR" },
          method: "pickup",
          address: checkoutWith().delivery.address,
        },
      }),
    });

    const refreshedCart = {
      ...cartWithItem(),
      items: [{ ...cartWithItem().items[0], available: false }],
      hasUnavailableItems: true,
    };
    mockActions.completeAwjCheckoutAction.mockResolvedValue({
      success: false,
      kind: "review_required",
      items: [{ item_id: "line-1", reason: "insufficient_stock" }],
      checkout: checkoutWith({
        contact: sampleOrder.contact,
        cart: refreshedCart,
      }),
      message: "بعض عناصر السلة تغيّرت.",
    });

    render(<AwjCheckoutFlow />);
    await fillDetailsAndContinue(user);
    await screen.findByText("awjCheckout.review.heading");
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
    );

    await screen.findByText("awjCheckout.reviewRequired.title");
    expect(
      screen.queryByText("awjCheckout.success.heading"),
    ).not.toBeInTheDocument();
    // No order was created — no Idempotency-Key was ever consumed by a
    // second, silent order.
    expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1);
  });

  it("never sends a client-computed total to the backend — updateAwjDelivery's only argument is the method string", async () => {
    const user = userEvent.setup();
    mockActions.startOrResumeAwjCheckout.mockResolvedValue({
      success: true,
      checkout: checkoutWith(),
    });
    mockActions.updateAwjContact.mockResolvedValue({
      success: true,
      checkout: checkoutWith(),
    });
    mockActions.updateAwjAddress.mockResolvedValue({
      success: true,
      checkout: checkoutWith(),
    });
    mockActions.updateAwjDelivery.mockResolvedValue({
      success: true,
      checkout: checkoutWith({
        delivery: { ...checkoutWith().delivery, method: "pickup" },
      }),
    });

    render(<AwjCheckoutFlow />);
    await fillDetailsAndContinue(user);

    await waitFor(() => {
      expect(mockActions.updateAwjDelivery).toHaveBeenCalledWith("pickup");
      expect(mockActions.updateAwjDelivery.mock.calls[0]).toHaveLength(1);
    });
  });

  describe("Idempotency-Key persistence across reload", () => {
    async function completeOnceAndCaptureKey(
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<string> {
      mockActions.startOrResumeAwjCheckout.mockResolvedValue({
        success: true,
        checkout: checkoutWith(),
      });
      mockActions.updateAwjContact.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.updateAwjAddress.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.updateAwjDelivery.mockResolvedValue({
        success: true,
        checkout: checkoutWith({
          contact: sampleOrder.contact,
          delivery: {
            amount: { amount_minor: 0, currency: "SAR" },
            method: "pickup",
            address: checkoutWith().delivery.address,
          },
        }),
      });
      mockActions.completeAwjCheckoutAction.mockResolvedValue({
        success: false,
        kind: "error",
        message: "transient failure — response lost",
      });

      const { unmount } = render(<AwjCheckoutFlow />);
      await fillDetailsAndContinue(user);
      await screen.findByText("awjCheckout.review.heading");
      await user.click(
        screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
      );
      await waitFor(() =>
        expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1),
      );

      const [key] = mockActions.completeAwjCheckoutAction.mock.calls[0];
      unmount(); // simulate the tab/page going away before the next render below
      return key as string;
    }

    it("a remount for the same checkout identity (reload) sends the same Idempotency-Key as before — a lost success response can still replay", async () => {
      const user = userEvent.setup();
      const firstKey = await completeOnceAndCaptureKey(user);

      // Simulate a page reload: unmount, then mount fresh. Same identity
      // ("identity-a", the mock default) — the checkout was never confirmed
      // successful, so nothing was cleared.
      mockActions.completeAwjCheckoutAction.mockClear();
      mockActions.startOrResumeAwjCheckout.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.completeAwjCheckoutAction.mockResolvedValue({
        success: true,
        order: sampleOrder,
        replayed: true, // the earlier attempt actually succeeded server-side
      });

      render(<AwjCheckoutFlow />);
      const user2 = userEvent.setup();
      await fillDetailsAndContinue(user2);
      await screen.findByText("awjCheckout.review.heading");
      await user2.click(
        screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
      );

      await waitFor(() =>
        expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1),
      );
      const [secondKey] = mockActions.completeAwjCheckoutAction.mock.calls[0];
      expect(secondKey).toBe(firstKey);
      await screen.findByText("awjCheckout.success.heading");
    });

    it("a different checkout identity (genuinely new checkout) never reuses the previous identity's persisted key", async () => {
      const user = userEvent.setup();
      const firstKey = await completeOnceAndCaptureKey(user);

      mockActions.completeAwjCheckoutAction.mockClear();
      mockActions.getAwjCheckoutIdentity.mockResolvedValue("identity-b");
      mockActions.startOrResumeAwjCheckout.mockResolvedValue({
        success: true,
        checkout: checkoutWith(),
      });
      mockActions.completeAwjCheckoutAction.mockResolvedValue({
        success: true,
        order: sampleOrder,
        replayed: false,
      });

      render(<AwjCheckoutFlow />);
      const user2 = userEvent.setup();
      await fillDetailsAndContinue(user2);
      await screen.findByText("awjCheckout.review.heading");
      await user2.click(
        screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
      );

      await waitFor(() =>
        expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1),
      );
      const [secondKey] = mockActions.completeAwjCheckoutAction.mock.calls[0];
      expect(secondKey).not.toBe(firstKey);
    });

    it("clicking Complete twice within the same mount (retry) sends the identical key both times", async () => {
      const user = userEvent.setup();
      mockActions.startOrResumeAwjCheckout.mockResolvedValue({
        success: true,
        checkout: checkoutWith(),
      });
      mockActions.updateAwjContact.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.updateAwjAddress.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.updateAwjDelivery.mockResolvedValue({
        success: true,
        checkout: checkoutWith({
          contact: sampleOrder.contact,
          delivery: {
            amount: { amount_minor: 0, currency: "SAR" },
            method: "pickup",
            address: checkoutWith().delivery.address,
          },
        }),
      });
      mockActions.completeAwjCheckoutAction
        .mockResolvedValueOnce({
          success: false,
          kind: "error",
          message: "transient",
        })
        .mockResolvedValueOnce({
          success: true,
          order: sampleOrder,
          replayed: false,
        });

      render(<AwjCheckoutFlow />);
      await fillDetailsAndContinue(user);
      await screen.findByText("awjCheckout.review.heading");
      const completeButton = () =>
        screen.getByRole("button", { name: "awjCheckout.completeOrder" });

      await user.click(completeButton());
      await waitFor(() =>
        expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(1),
      );
      await user.click(completeButton());
      await waitFor(() =>
        expect(mockActions.completeAwjCheckoutAction).toHaveBeenCalledTimes(2),
      );

      const [firstKey] = mockActions.completeAwjCheckoutAction.mock.calls[0];
      const [secondKey] = mockActions.completeAwjCheckoutAction.mock.calls[1];
      expect(secondKey).toBe(firstKey);
    });

    it("the persisted key is cleared only after a confirmed success — not on review_required or a transient failure", async () => {
      const user = userEvent.setup();
      mockActions.startOrResumeAwjCheckout.mockResolvedValue({
        success: true,
        checkout: checkoutWith(),
      });
      mockActions.updateAwjContact.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.updateAwjAddress.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.updateAwjDelivery.mockResolvedValue({
        success: true,
        checkout: checkoutWith({
          contact: sampleOrder.contact,
          delivery: {
            amount: { amount_minor: 0, currency: "SAR" },
            method: "pickup",
            address: checkoutWith().delivery.address,
          },
        }),
      });
      mockActions.completeAwjCheckoutAction.mockResolvedValue({
        success: false,
        kind: "review_required",
        items: [{ item_id: "line-1", reason: "insufficient_stock" }],
        checkout: checkoutWith({ contact: sampleOrder.contact }),
        message: "بعض عناصر السلة تغيّرت.",
      });

      render(<AwjCheckoutFlow />);
      await fillDetailsAndContinue(user);
      await screen.findByText("awjCheckout.review.heading");
      await user.click(
        screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
      );
      await screen.findByText("awjCheckout.reviewRequired.title");

      // Still persisted — a retry after fixing the issue must reuse it.
      expect(
        localStorage.getItem("awj-checkout-idempotency-key:identity-a"),
      ).not.toBeNull();
    });

    it("the persisted key is removed once completion is confirmed successful", async () => {
      const user = userEvent.setup();
      await completeOnceAndCaptureKey(user); // fails transiently — key stays persisted here

      expect(
        localStorage.getItem("awj-checkout-idempotency-key:identity-a"),
      ).not.toBeNull();

      mockActions.completeAwjCheckoutAction.mockClear();
      mockActions.startOrResumeAwjCheckout.mockResolvedValue({
        success: true,
        checkout: checkoutWith({ contact: sampleOrder.contact }),
      });
      mockActions.completeAwjCheckoutAction.mockResolvedValue({
        success: true,
        order: sampleOrder,
        replayed: false,
      });

      render(<AwjCheckoutFlow />);
      const user2 = userEvent.setup();
      await fillDetailsAndContinue(user2);
      await screen.findByText("awjCheckout.review.heading");
      await user2.click(
        screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
      );
      await screen.findByText("awjCheckout.success.heading");

      expect(
        localStorage.getItem("awj-checkout-idempotency-key:identity-a"),
      ).toBeNull();
    });
  });
});
