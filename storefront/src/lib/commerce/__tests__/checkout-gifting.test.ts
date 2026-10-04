import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GIFT_OPTIONS_DISABLED,
  mapCheckoutSchedule,
  mapDeliverySchedule,
  mapGift,
  mapGiftOptions,
  mapOrderSchedule,
  scheduleMethodFor,
} from "../checkout-gifting";
import {
  mapAwjCheckoutToViewModel,
  mapAwjOrderToViewModel,
} from "../checkout-types";

const mocks = vi.hoisted(() => ({
  storefrontCartRequest: vi.fn(),
  storefrontFetch: vi.fn(),
}));
vi.mock("../config", () => mocks);

const {
  fetchAwjDeliverySchedule,
  updateAwjCheckoutGift,
  updateAwjCheckoutSchedule,
} = await import("../checkout");

const SLOT = "0a1b2c3d-1111-4222-8333-444455556666";
const money = (n: number) => ({ amount_minor: n, currency: "SAR" });

const rawSlot = (over: Record<string, unknown> = {}) => ({
  id: SLOT,
  label: "مساءً",
  label_en: "Evening",
  start_time: "17:00",
  end_time: "21:00",
  ...over,
});

describe("gift mapping (FLOWERS-H12b)", () => {
  it("maps a gift and treats absence as not a gift", () => {
    expect(mapGift(null)).toBeNull();
    expect(mapGift(undefined)).toBeNull();
    expect(
      mapGift({
        recipient_name: "منى",
        recipient_phone: "0555",
        sender_display_name: null,
        hide_sender: true,
        message: "كل عام وأنتِ بخير",
      }),
    ).toEqual({
      recipientName: "منى",
      recipientPhone: "0555",
      senderDisplayName: null,
      hideSender: true,
      message: "كل عام وأنتِ بخير",
    });
  });

  it("reads the gift policy, with safe defaults and no gifting when it is off or absent", () => {
    expect(mapGiftOptions(undefined)).toEqual(GIFT_OPTIONS_DISABLED);
    expect(
      mapGiftOptions({
        enabled: false,
        message_max_length: 100,
        allow_hide_sender: false,
        recipient_phone_required: false,
      }),
    ).toEqual(GIFT_OPTIONS_DISABLED);
    expect(
      mapGiftOptions({
        enabled: true,
        message_max_length: 120,
        allow_hide_sender: false,
        recipient_phone_required: false,
      }),
    ).toEqual({
      enabled: true,
      messageMaxLength: 120,
      allowHideSender: false,
      recipientPhoneRequired: false,
    });
    // A malformed limit falls back to the default rather than 0 / NaN.
    expect(
      mapGiftOptions({
        enabled: true,
        message_max_length: -5 as never,
        allow_hide_sender: true,
        recipient_phone_required: true,
      }).messageMaxLength,
    ).toBe(250);
  });
});

describe("schedule mapping (FLOWERS-H12b)", () => {
  it("maps a stored selection and marks an unselectable one invalid", () => {
    expect(mapCheckoutSchedule(undefined)).toBeNull();
    expect(
      mapCheckoutSchedule({ date: "2026-10-05", slot: rawSlot(), valid: true }),
    ).toEqual({
      date: "2026-10-05",
      valid: true,
      slot: {
        id: SLOT,
        label: "مساءً",
        labelEn: "Evening",
        startTime: "17:00",
        endTime: "21:00",
      },
    });
    expect(
      mapCheckoutSchedule({ date: "2026-10-05", slot: null, valid: false }),
    ).toEqual({
      date: "2026-10-05",
      valid: false,
      slot: null,
    });
    // `valid: true` without a usable slot cannot be trusted.
    expect(
      mapCheckoutSchedule({
        date: "2026-10-05",
        slot: { id: SLOT },
        valid: true,
      })?.valid,
    ).toBe(false);
  });

  it("drops a malformed stored date or window", () => {
    expect(
      mapCheckoutSchedule({ date: "tomorrow", slot: rawSlot(), valid: true }),
    ).toBeNull();
    expect(
      mapCheckoutSchedule({
        date: "2026-10-05",
        slot: rawSlot({ start_time: "5pm" }),
        valid: true,
      })?.slot,
    ).toBeNull();
  });

  it("maps the immutable order schedule and rejects an incomplete one", () => {
    const good = {
      method: "delivery" as const,
      date: "2026-10-05",
      timezone: "Asia/Riyadh",
      slot: {
        label: "مساءً",
        label_en: null,
        start_time: "17:00",
        end_time: "21:00",
      },
    };
    expect(mapOrderSchedule(good)).toEqual({
      method: "delivery",
      date: "2026-10-05",
      timezone: "Asia/Riyadh",
      slot: {
        label: "مساءً",
        labelEn: null,
        startTime: "17:00",
        endTime: "21:00",
      },
    });
    expect(mapOrderSchedule(undefined)).toBeNull();
    expect(
      mapOrderSchedule({ ...good, method: "courier" as never }),
    ).toBeNull();
    expect(mapOrderSchedule({ ...good, timezone: "" })).toBeNull();
    expect(
      mapOrderSchedule({ ...good, slot: { ...good.slot, end_time: "late" } }),
    ).toBeNull();
  });

  it("names the schedule method from the checkout's delivery method", () => {
    expect(scheduleMethodFor("standard")).toBe("delivery");
    expect(scheduleMethodFor("pickup")).toBe("pickup");
    expect(scheduleMethodFor(null)).toBeNull();
    expect(scheduleMethodFor("drone")).toBeNull();
  });

  it("maps selectable dates: validated, deduplicated, empty days dropped, 'required' read as sent", () => {
    const parsed = mapDeliverySchedule(
      {
        enabled: true,
        required: true,
        method: "delivery",
        timezone: "Asia/Riyadh",
        earliest: null,
        dates: [
          { date: "2026-10-05", slots: [rawSlot(), { id: "x" }] },
          { date: "2026-10-05", slots: [rawSlot()] },
          { date: "2026-10-06", slots: [] },
          { date: "nope", slots: [rawSlot()] },
          {
            date: "2026-10-07",
            slots: [rawSlot({ id: "1a1b2c3d-1111-4222-8333-444455556666" })],
          },
        ],
      },
      "delivery",
    );
    expect(parsed.enabled).toBe(true);
    expect(parsed.required).toBe(true);
    expect(parsed.timezone).toBe("Asia/Riyadh");
    expect(parsed.dates.map((d) => [d.date, d.slots.length])).toEqual([
      ["2026-10-05", 1],
      ["2026-10-07", 1],
    ]);
  });

  it("reads disabled, absent or malformed schedules as no scheduling", () => {
    for (const raw of [
      undefined,
      null,
      "x",
      { enabled: false, dates: [{ date: "2026-10-05", slots: [rawSlot()] }] },
    ]) {
      expect(mapDeliverySchedule(raw, "pickup")).toEqual({
        enabled: false,
        required: false,
        method: "pickup",
        timezone: null,
        dates: [],
      });
    }
  });
});

describe("checkout and order view models carry gift and schedule (FLOWERS-H12b)", () => {
  const baseCheckout = {
    status: "active" as const,
    contact: { name: null, phone: null, email: null },
    delivery: {
      method: null,
      amount: money(0),
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
    cart: {
      status: null,
      items: [],
      subtotal: money(0),
      currency: "SAR",
      has_unavailable_items: false,
    },
  };

  it("an older API without gift fields maps to no gift, gifting disabled and no schedule", () => {
    const view = mapAwjCheckoutToViewModel(baseCheckout as never);
    expect(view.gift).toBeNull();
    expect(view.giftOptions).toEqual(GIFT_OPTIONS_DISABLED);
    expect(view.schedule).toBeNull();
  });

  it("maps gift, options and schedule when present, and gift and schedule on the order", () => {
    const view = mapAwjCheckoutToViewModel({
      ...baseCheckout,
      gift: {
        recipient_name: "منى",
        recipient_phone: null,
        sender_display_name: "سالم",
        hide_sender: false,
        message: null,
      },
      gift_options: {
        enabled: true,
        message_max_length: 100,
        allow_hide_sender: true,
        recipient_phone_required: false,
      },
      schedule: { date: "2026-10-05", slot: rawSlot(), valid: true },
    } as never);
    expect(view.gift?.recipientName).toBe("منى");
    expect(view.giftOptions.enabled).toBe(true);
    expect(view.schedule?.slot?.id).toBe(SLOT);

    const order = mapAwjOrderToViewModel({
      id: "o",
      number: "N",
      status: "confirmed",
      delivery_method: "standard",
      total: money(1),
      contact: { name: null, phone: null, email: null },
      delivery: {
        country: null,
        city: null,
        district: null,
        street: null,
        postal_code: null,
        notes: null,
      },
      payment: { method: null, status: null, payment_method_name: null },
      gift: {
        recipient_name: "منى",
        recipient_phone: null,
        sender_display_name: null,
        hide_sender: true,
        message: "hi",
      },
      schedule: {
        method: "delivery",
        date: "2026-10-05",
        timezone: "Asia/Riyadh",
        slot: {
          label: "x",
          label_en: null,
          start_time: "09:00",
          end_time: "10:00",
        },
      },
      items: [],
      created_at: null,
    } as never);
    expect(order.gift?.hideSender).toBe(true);
    expect(order.schedule?.method).toBe("delivery");
  });
});

describe("checkout gift / schedule client (FLOWERS-H12b)", () => {
  beforeEach(() => {
    mocks.storefrontCartRequest.mockReset();
    mocks.storefrontFetch.mockReset();
  });

  const checkoutBody = {
    data: {
      status: "active",
      contact: { name: null, phone: null, email: null },
      delivery: {
        method: null,
        amount: money(0),
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
      cart: {
        status: null,
        items: [],
        subtotal: money(0),
        currency: "SAR",
        has_unavailable_items: false,
      },
    },
  };

  it("PATCHes the gift context to checkout/gift verbatim", async () => {
    mocks.storefrontCartRequest.mockResolvedValue(checkoutBody);
    await updateAwjCheckoutGift({
      is_gift: true,
      recipient_name: "منى",
      hide_sender: false,
    });
    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "PATCH",
      "checkout/gift",
      {
        is_gift: true,
        recipient_name: "منى",
        hide_sender: false,
      },
    );
  });

  it("PATCHes the schedule with both keys, including both null to clear", async () => {
    mocks.storefrontCartRequest.mockResolvedValue(checkoutBody);
    await updateAwjCheckoutSchedule({ date: "2026-10-05", slot_id: SLOT });
    await updateAwjCheckoutSchedule({ date: null, slot_id: null });
    expect(mocks.storefrontCartRequest).toHaveBeenNthCalledWith(
      1,
      "PATCH",
      "checkout/schedule",
      { date: "2026-10-05", slot_id: SLOT },
    );
    expect(mocks.storefrontCartRequest).toHaveBeenNthCalledWith(
      2,
      "PATCH",
      "checkout/schedule",
      { date: null, slot_id: null },
    );
  });

  it("reads the selectable windows with the method and destination, never cached", async () => {
    mocks.storefrontFetch.mockResolvedValue({
      data: {
        enabled: true,
        required: false,
        method: "delivery",
        timezone: "Asia/Riyadh",
        earliest: null,
        dates: [{ date: "2026-10-05", slots: [rawSlot()] }],
      },
    });
    const result = await fetchAwjDeliverySchedule("delivery", {
      city: "الدمام",
      region: null,
    });
    expect(mocks.storefrontFetch).toHaveBeenCalledWith(
      "delivery-schedule",
      { method: "delivery", city: "الدمام", region: undefined },
      { cache: "no-store" },
    );
    expect(result.dates).toHaveLength(1);
    expect(result.required).toBe(false);
  });
});
