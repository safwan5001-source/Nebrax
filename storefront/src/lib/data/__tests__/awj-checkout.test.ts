import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAwjCheckoutAdapter = vi.hoisted(() => ({
  fetchAwjCheckout: vi.fn(),
  createOrResumeAwjCheckout: vi.fn(),
  updateAwjCheckoutContact: vi.fn(),
  updateAwjCheckoutAddress: vi.fn(),
  updateAwjCheckoutDelivery: vi.fn(),
  completeAwjCheckout: vi.fn(),
}));

vi.mock("@/lib/commerce/checkout", () => mockAwjCheckoutAdapter);

// Real StorefrontApiError class (not mocked) — awj-checkout.ts narrows
// failures with `instanceof StorefrontApiError`, so tests need the real
// class to construct realistic failures.
const { StorefrontApiError } = await import("@/lib/commerce/config");

const {
  completeAwjCheckoutAction,
  getAwjCheckout,
  startOrResumeAwjCheckout,
  updateAwjAddress,
  updateAwjContact,
  updateAwjDelivery,
} = await import("../awj-checkout");

const sampleCheckout = {
  status: "active" as const,
  contact: { name: "سالم", phone: "0500000000", email: null },
  delivery: {
    method: "pickup",
    amount: { amount_minor: 0, currency: "SAR" },
    address: {
      country: "SA",
      region: null,
      city: "الدمام",
      district: null,
      street: "شارع",
      postal_code: null,
      notes: null,
    },
  },
  cart: {
    kind: "awj" as const,
    items: [],
    subtotal: { amount_minor: 0, currency: "SAR" },
    currency: "SAR",
    hasUnavailableItems: false,
    itemCount: 0,
  },
};

const sampleOrder = {
  id: "order-1",
  number: "CORD-2026-00001",
  status: "confirmed",
  deliveryMethod: "pickup",
  total: { amount_minor: 5000, currency: "SAR" },
  contact: { name: "سالم", phone: "0500000000", email: null },
  delivery: {
    country: "SA",
    city: "الدمام",
    district: null,
    street: "شارع",
    postal_code: null,
    notes: null,
  },
  items: [],
  createdAt: "2026-01-01T00:00:00Z",
};

describe("data/awj-checkout — server actions", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockAwjCheckoutAdapter)) {
      mock.mockReset();
    }
  });

  it("getAwjCheckout returns the checkout on success", async () => {
    mockAwjCheckoutAdapter.fetchAwjCheckout.mockResolvedValue(sampleCheckout);

    const result = await getAwjCheckout();

    expect(result).toEqual(sampleCheckout);
  });

  it("getAwjCheckout returns null on failure rather than throwing", async () => {
    mockAwjCheckoutAdapter.fetchAwjCheckout.mockRejectedValue(
      new Error("boom"),
    );

    await expect(getAwjCheckout()).resolves.toBeNull();
  });

  it("startOrResumeAwjCheckout returns { success: true, checkout } on success", async () => {
    mockAwjCheckoutAdapter.createOrResumeAwjCheckout.mockResolvedValue(
      sampleCheckout,
    );

    const result = await startOrResumeAwjCheckout();

    expect(result).toEqual({ success: true, checkout: sampleCheckout });
  });

  it("startOrResumeAwjCheckout returns { success: false } when there is no usable cart/checkout", async () => {
    mockAwjCheckoutAdapter.createOrResumeAwjCheckout.mockRejectedValue(
      new StorefrontApiError(404, "not_found", "جلسة الدفع غير متاحة."),
    );

    const result = await startOrResumeAwjCheckout();

    expect(result.success).toBe(false);
  });

  it("updateAwjContact forwards fields and returns the updated checkout", async () => {
    mockAwjCheckoutAdapter.updateAwjCheckoutContact.mockResolvedValue(
      sampleCheckout,
    );

    const result = await updateAwjContact({ name: "سالم", phone: "05" });

    expect(
      mockAwjCheckoutAdapter.updateAwjCheckoutContact,
    ).toHaveBeenCalledWith({ name: "سالم", phone: "05" });
    expect(result).toEqual({ success: true, checkout: sampleCheckout });
  });

  it("updateAwjAddress forwards fields and returns the updated checkout", async () => {
    mockAwjCheckoutAdapter.updateAwjCheckoutAddress.mockResolvedValue(
      sampleCheckout,
    );

    const result = await updateAwjAddress({ country: "SA" });

    expect(result).toEqual({ success: true, checkout: sampleCheckout });
  });

  it("updateAwjDelivery forwards the method and returns the updated checkout", async () => {
    mockAwjCheckoutAdapter.updateAwjCheckoutDelivery.mockResolvedValue(
      sampleCheckout,
    );

    const result = await updateAwjDelivery("pickup");

    expect(
      mockAwjCheckoutAdapter.updateAwjCheckoutDelivery,
    ).toHaveBeenCalledWith("pickup");
    expect(result).toEqual({ success: true, checkout: sampleCheckout });
  });

  describe("completeAwjCheckoutAction", () => {
    it("returns { success: true, order, replayed } on success", async () => {
      mockAwjCheckoutAdapter.completeAwjCheckout.mockResolvedValue({
        order: sampleOrder,
        replayed: false,
      });

      const result = await completeAwjCheckoutAction("key-1");

      expect(mockAwjCheckoutAdapter.completeAwjCheckout).toHaveBeenCalledWith(
        "key-1",
      );
      expect(result).toEqual({
        success: true,
        order: sampleOrder,
        replayed: false,
      });
    });

    it("surfaces a 409 review_required as its own kind, not a generic error — with items and refreshed checkout", async () => {
      mockAwjCheckoutAdapter.completeAwjCheckout.mockRejectedValue(
        new StorefrontApiError(
          409,
          "review_required",
          "بعض عناصر السلة تغيّرت.",
          {
            items: [{ item_id: "line-1", reason: "insufficient_stock" }],
            checkout: {
              status: "active",
              contact: sampleCheckout.contact,
              delivery: sampleCheckout.delivery,
              cart: {
                status: null,
                items: [],
                subtotal: { amount_minor: 0, currency: "SAR" },
                currency: "SAR",
                has_unavailable_items: true,
              },
            },
          },
        ),
      );

      const result = await completeAwjCheckoutAction("key-2");

      expect(result.success).toBe(false);
      if (result.success) throw new Error("unreachable");
      expect(result.kind).toBe("review_required");
      if (result.kind !== "review_required") throw new Error("unreachable");
      expect(result.items).toEqual([
        { item_id: "line-1", reason: "insufficient_stock" },
      ]);
      expect(result.checkout.cart.hasUnavailableItems).toBe(true);
    });

    it("surfaces a 409 idempotency_conflict as its own kind", async () => {
      mockAwjCheckoutAdapter.completeAwjCheckout.mockRejectedValue(
        new StorefrontApiError(
          409,
          "idempotency_conflict",
          "جلسة الدفع مكتملة بالفعل بمفتاحٍ أو حمولةٍ مختلفة.",
        ),
      );

      const result = await completeAwjCheckoutAction("key-3");

      expect(result.success).toBe(false);
      if (result.success) throw new Error("unreachable");
      expect(result.kind).toBe("idempotency_conflict");
    });

    it("surfaces a 404 not_found as its own kind (expired/missing checkout)", async () => {
      mockAwjCheckoutAdapter.completeAwjCheckout.mockRejectedValue(
        new StorefrontApiError(404, "not_found", "جلسة الدفع غير متاحة."),
      );

      const result = await completeAwjCheckoutAction("key-4");

      expect(result.success).toBe(false);
      if (result.success) throw new Error("unreachable");
      expect(result.kind).toBe("not_found");
    });

    it("falls back to a generic error kind for anything else", async () => {
      mockAwjCheckoutAdapter.completeAwjCheckout.mockRejectedValue(
        new Error("network exploded"),
      );

      const result = await completeAwjCheckoutAction("key-5");

      expect(result.success).toBe(false);
      if (result.success) throw new Error("unreachable");
      expect(result.kind).toBe("error");
    });
  });
});
