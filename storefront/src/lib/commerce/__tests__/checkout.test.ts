import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storefrontCartRequest: vi.fn(),
}));

vi.mock("../config", () => ({
  storefrontCartRequest: mocks.storefrontCartRequest,
}));

const {
  completeAwjCheckout,
  createOrResumeAwjCheckout,
  fetchAwjCheckout,
  fetchAwjPaymentMethods,
  updateAwjCheckoutPayment,
  updateAwjCheckoutAddress,
  updateAwjCheckoutContact,
  updateAwjCheckoutDelivery,
} = await import("../checkout");

const emptyAwjCheckout = {
  status: null,
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
  cart: {
    status: null,
    items: [],
    subtotal: { amount_minor: 0, currency: "SAR" },
    currency: "SAR",
    has_unavailable_items: false,
  },
};

describe("commerce/checkout — AWJ Checkout V1 client", () => {
  beforeEach(() => {
    mocks.storefrontCartRequest.mockReset();
    mocks.storefrontCartRequest.mockResolvedValue({
      data: emptyAwjCheckout,
      meta: { request_id: "req-1" },
    });
  });

  it("fetchAwjCheckout issues a bare GET to checkout — never creates one", async () => {
    await fetchAwjCheckout();

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith("GET", "checkout");
  });

  it("createOrResumeAwjCheckout POSTs with no body — the backend decides create vs. resume", async () => {
    await createOrResumeAwjCheckout();

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "POST",
      "checkout",
    );
  });

  it("updateAwjCheckoutContact PATCHes exactly the given contact fields — never a price/total", async () => {
    await updateAwjCheckoutContact({ name: "سالم", phone: "0500000000" });

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "PATCH",
      "checkout/contact",
      { name: "سالم", phone: "0500000000" },
    );
  });

  it("updateAwjCheckoutAddress PATCHes exactly the given address fields", async () => {
    await updateAwjCheckoutAddress({ country: "SA", city: "الدمام" });

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "PATCH",
      "checkout/address",
      { country: "SA", city: "الدمام" },
    );
  });

  it("updateAwjCheckoutDelivery PATCHes only { method } — the signature makes a client amount structurally impossible to send", async () => {
    await updateAwjCheckoutDelivery("pickup");

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "PATCH",
      "checkout/delivery",
      { method: "pickup" },
    );
  });

  it("completeAwjCheckout POSTs an empty body and attaches Idempotency-Key as a header — never in the body, never a client total", async () => {
    mocks.storefrontCartRequest.mockResolvedValueOnce({
      data: {
        order: {
          id: "order-1",
          number: "CORD-2026-00001",
          status: "confirmed",
          delivery_method: "pickup",
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
          created_at: "2026-01-01T00:00:00Z",
        },
        replayed: false,
      },
      meta: { request_id: "req-2" },
    });

    const result = await completeAwjCheckout("stable-key-abc123");

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "POST",
      "checkout/complete",
      {},
      { "Idempotency-Key": "stable-key-abc123" },
    );
    expect(result.order.id).toBe("order-1");
    expect(result.replayed).toBe(false);
  });

  it("passing the same idempotencyKey twice sends the identical header both times (stable across a retry)", async () => {
    mocks.storefrontCartRequest.mockResolvedValue({
      data: {
        order: {
          id: "order-1",
          number: "CORD-2026-00001",
          status: "confirmed",
          delivery_method: "pickup",
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
          created_at: "2026-01-01T00:00:00Z",
        },
        replayed: true,
      },
      meta: { request_id: "req-3" },
    });

    await completeAwjCheckout("retry-key");
    await completeAwjCheckout("retry-key");

    const calls = mocks.storefrontCartRequest.mock.calls;
    expect(calls[0][3]).toEqual({ "Idempotency-Key": "retry-key" });
    expect(calls[1][3]).toEqual({ "Idempotency-Key": "retry-key" });
  });

  describe("Beta — merchant-enabled online payment methods", () => {
    const cash = {
      id: "pm-cash",
      name: "نقدي",
      name_en: "Cash",
      settlement_type: "cash",
    };
    const card = {
      id: "pm-card",
      name: "بطاقة",
      name_en: "Card",
      settlement_type: "bank",
      online: true,
    };

    it("an older API (no online_methods) returns the list unchanged — byte for byte", async () => {
      mocks.storefrontCartRequest.mockResolvedValue({
        data: { payment_methods: [cash, card] },
        meta: {},
      });

      expect(await fetchAwjPaymentMethods()).toEqual([cash, card]);
    });

    it("lists every enabled online method; a ready one absorbs the cash/bank method it resolves to, an unready one stays visible", async () => {
      mocks.storefrontCartRequest.mockResolvedValue({
        data: {
          payment_methods: [cash, card],
          online_methods: [
            { key: "mada", ready: true, payment_method_id: "pm-card" },
            { key: "visa", ready: false, payment_method_id: null },
          ],
        },
        meta: {},
      });

      const list = await fetchAwjPaymentMethods();

      expect(list.map((m) => m.id)).toEqual([
        "pm-cash",
        "online:mada",
        "online:visa",
      ]);
      expect(list[1]).toMatchObject({
        onlineKey: "mada",
        ready: true,
        linkedMethodId: "pm-card",
        online: true,
      });
      expect(list[2]).toMatchObject({
        onlineKey: "visa",
        ready: false,
        linkedMethodId: null,
      });
    });

    it("with only unready online methods the linked online cash/bank method is NOT hidden (nothing resolves to it)", async () => {
      mocks.storefrontCartRequest.mockResolvedValue({
        data: {
          payment_methods: [cash, card],
          online_methods: [
            { key: "mada", ready: false, payment_method_id: null },
          ],
        },
        meta: {},
      });

      expect((await fetchAwjPaymentMethods()).map((m) => m.id)).toEqual([
        "pm-cash",
        "pm-card",
        "online:mada",
      ]);
    });

    it("selecting an online method PATCHes { online_method } only — never an id, amount or provider", async () => {
      await updateAwjCheckoutPayment("online:mada", "mada");

      expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
        "PATCH",
        "checkout/payment",
        { online_method: "mada" },
      );
    });

    it("a plain method still PATCHes { payment_method_id } exactly as before", async () => {
      await updateAwjCheckoutPayment("pm-cash");

      expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
        "PATCH",
        "checkout/payment",
        { payment_method_id: "pm-cash" },
      );
    });
  });
});
