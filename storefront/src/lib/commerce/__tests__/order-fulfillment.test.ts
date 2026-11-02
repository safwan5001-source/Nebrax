import { describe, expect, it } from "vitest";
import {
  mapAwjOrderToViewModel,
  mapOrderFulfillment,
  type AwjOrder,
  type AwjOrderFulfillment,
} from "../checkout-types";

const block = (over: Partial<AwjOrderFulfillment> = {}): AwjOrderFulfillment => ({
  type: "carrier",
  stage: "out_for_delivery",
  stages: [
    { key: "placed", at: "2026-11-02T09:00:00+03:00" },
    { key: "preparing", at: "2026-11-02T10:00:00+03:00" },
    { key: "out_for_delivery", at: "2026-11-02T12:00:00+03:00" },
  ],
  tracking: { carrier: "SMSA", number: "T-1", url: "https://track.example.test/T-1" },
  pickup: null,
  ...over,
});

const order = (over: Partial<AwjOrder> = {}): AwjOrder => ({
  id: "o1",
  number: "CORD-1",
  status: "confirmed",
  delivery_method: "standard",
  total: { amount_minor: 11500, currency: "SAR" },
  contact: { name: "Sara", phone: null, email: null },
  delivery: { country: "SA", city: "Dammam", district: null, street: null, postal_code: null, notes: null },
  payment: { method: "cod", status: "awaiting_collection", payment_method_name: null },
  items: [],
  created_at: "2026-11-02T09:00:00+03:00",
  ...over,
});

describe("mapOrderFulfillment (COPS-H2-4)", () => {
  it("maps a well-formed block field by field", () => {
    const mapped = mapOrderFulfillment(block());
    expect(mapped).toEqual({
      type: "carrier",
      stage: "out_for_delivery",
      stages: [
        { key: "placed", at: "2026-11-02T09:00:00+03:00" },
        { key: "preparing", at: "2026-11-02T10:00:00+03:00" },
        { key: "out_for_delivery", at: "2026-11-02T12:00:00+03:00" },
      ],
      tracking: { carrier: "SMSA", number: "T-1", url: "https://track.example.test/T-1" },
      pickup: null,
    });
  });

  it("is null for an absent block, so the order stays 'placed' only", () => {
    expect(mapOrderFulfillment(undefined)).toBeNull();
    expect(mapOrderFulfillment(null)).toBeNull();
    expect(mapAwjOrderToViewModel(order()).fulfillment).toBeNull();
  });

  it("is null for an unknown type or stage instead of guessing progress", () => {
    expect(mapOrderFulfillment(block({ type: "drone" }))).toBeNull();
    expect(mapOrderFulfillment(block({ stage: "teleported" }))).toBeNull();
    expect(mapOrderFulfillment({ ...block(), stages: "x" } as unknown as AwjOrderFulfillment)).toBeNull();
  });

  it("drops unknown stage entries but keeps the known ones", () => {
    const mapped = mapOrderFulfillment(
      block({ stages: [{ key: "placed", at: null }, { key: "mystery", at: "x" }, { key: "preparing", at: "" }] }),
    );
    expect(mapped?.stages).toEqual([
      { key: "placed", at: null },
      { key: "preparing", at: null },
    ]);
  });

  it("only ever keeps an https tracking link", () => {
    for (const url of ["http://track.example.test/1", "javascript:alert(1)", "//evil.test", "ftp://x"]) {
      expect(mapOrderFulfillment(block({ tracking: { carrier: "X", number: "1", url } }))?.tracking?.url).toBeNull();
    }
    expect(
      mapOrderFulfillment(block({ tracking: { carrier: "X", number: "1", url: "HTTPS://Track.Example.test/1" } }))?.tracking?.url,
    ).toBe("HTTPS://Track.Example.test/1");
  });

  it("maps pickup readiness", () => {
    const mapped = mapOrderFulfillment(block({ type: "pickup", stage: "ready", tracking: null, pickup: { ready_at: "2026-11-02T13:00:00+03:00" } }));
    expect(mapped?.pickup).toEqual({ readyAt: "2026-11-02T13:00:00+03:00" });
    expect(mapped?.tracking).toBeNull();
  });

  it("does not copy any unknown field from the payload (courier, reason, attempts…)", () => {
    const hostile = { ...block(), courier: { name: "Khalid" }, last_failure: { reason: "x" }, delivery_attempts: 3 } as unknown as AwjOrderFulfillment;
    expect(JSON.stringify(mapOrderFulfillment(hostile))).not.toMatch(/Khalid|last_failure|delivery_attempts|courier/);
  });
});
