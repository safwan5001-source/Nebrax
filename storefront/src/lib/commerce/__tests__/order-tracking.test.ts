import { describe, expect, it } from "vitest";
import { mapOrderTracking } from "../order-tracking";

const raw = (over: Record<string, unknown> = {}) => ({
  number: "CORD-1",
  status: "confirmed",
  delivery_method: "pickup",
  placed_at: "2026-11-02T09:00:00+03:00",
  expires_at: "2027-01-31T09:00:00+00:00",
  ...over,
});

describe("mapOrderTracking (COPS-H2-5)", () => {
  it("maps the narrow projection", () => {
    expect(mapOrderTracking(raw())).toEqual({
      number: "CORD-1",
      status: "confirmed",
      deliveryMethod: "pickup",
      placedAt: "2026-11-02T09:00:00+03:00",
      cancelledAt: null,
      schedule: null,
      fulfillment: null,
      expiresAt: "2027-01-31T09:00:00+00:00",
    });
  });

  it("is null for an unreadable payload instead of inventing an order", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      {},
      { number: "A" },
      { status: "confirmed" },
    ]) {
      expect(mapOrderTracking(bad)).toBeNull();
    }
  });

  it("reads the fulfilment block defensively and ignores progress for a cancelled order", () => {
    const block = {
      type: "pickup",
      stage: "ready",
      stages: [{ key: "placed", at: null }],
      tracking: null,
      pickup: { ready_at: "2026-11-02T13:00:00+03:00" },
    };
    expect(
      mapOrderTracking(raw({ fulfillment: block }))?.fulfillment?.stage,
    ).toBe("ready");
    expect(
      mapOrderTracking(raw({ fulfillment: { ...block, stage: "teleported" } }))
        ?.fulfillment,
    ).toBeNull();
    const cancelled = mapOrderTracking(
      raw({
        status: "cancelled",
        cancellation: { cancelled_at: "2026-11-03T10:00:00+03:00" },
        fulfillment: block,
      }),
    );
    expect(cancelled?.fulfillment).toBeNull();
    expect(cancelled?.cancelledAt).toBe("2026-11-03T10:00:00+03:00");
  });

  it("keeps the requested date/window and nothing else from the schedule", () => {
    const mapped = mapOrderTracking(
      raw({
        schedule: {
          method: "delivery",
          date: "2026-11-05",
          slot: {
            label: "مساءً",
            label_en: "Evening",
            start_time: "17:00",
            end_time: "20:00",
          },
          timezone: "Asia/Riyadh",
          street: "secret",
        },
      }),
    );
    expect(mapped?.schedule).toEqual({
      date: "2026-11-05",
      label: "مساءً",
      labelEn: "Evening",
      start: "17:00",
      end: "20:00",
    });
    expect(JSON.stringify(mapped)).not.toContain("secret");
  });

  it("does not copy fields that are not in the whitelist (name, address, items, total)", () => {
    const mapped = mapOrderTracking(
      raw({
        contact: { name: "Sara" },
        delivery: { street: "X" },
        items: [{ product_name: "Rose" }],
        total: { amount_minor: 1 },
      }),
    );
    expect(JSON.stringify(mapped)).not.toMatch(/Sara|"X"|Rose|amount_minor/);
  });
});
