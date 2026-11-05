import { describe, expect, it } from "vitest";
import {
  type AwjOrdering,
  isolateBidi,
  minimumOrderView,
  readOrdering,
} from "../ordering";

/** The exact shape `CommerceChannelIntakeGuard::publicBlock()` emits (backend contract, ADR-29 §2.5.3). */
const wire = (over: Record<string, unknown> = {}) => ({
  accepting: true,
  reason: null,
  message: null,
  resumes_at: null,
  min_order_minor: null,
  min_order_scope: "all",
  ...over,
});

describe("readOrdering — the buyer-side reading of data.ordering (COPS-H4 Buyer Ordering UX)", () => {
  it("reads an accepting store with no minimum", () => {
    expect(readOrdering(wire())).toEqual({
      accepting: true,
      reason: null,
      message: null,
      resumesAt: null,
      minOrderMinor: null,
      minOrderScope: "all",
    });
  });

  it("reads a paused store with the merchant's note and a scheduled resume", () => {
    expect(
      readOrdering(
        wire({
          accepting: false,
          reason: "paused",
          message: "  Back at 5pm  ",
          resumes_at: "2026-11-09T14:00:00+00:00",
        }),
      ),
    ).toEqual({
      accepting: false,
      reason: "paused",
      message: "Back at 5pm",
      resumesAt: "2026-11-09T14:00:00+00:00",
      minOrderMinor: null,
      minOrderScope: "all",
    });
  });

  it("reads outside opening hours; the note and resume time never apply to it", () => {
    const ordering = readOrdering(
      wire({
        accepting: false,
        reason: "outside_hours",
        message: "should be ignored",
        resumes_at: "2026-11-09T14:00:00+00:00",
      }),
    );
    expect(ordering).toMatchObject({
      accepting: false,
      reason: "outside_hours",
      message: null,
      resumesAt: null,
    });
  });

  it("reads the minimum order and its scope", () => {
    expect(
      readOrdering(
        wire({ min_order_minor: 15000, min_order_scope: "delivery_only" }),
      ),
    ).toMatchObject({ minOrderMinor: 15000, minOrderScope: "delivery_only" });
  });

  it("keeps the merchant note to plain text of at most 200 characters", () => {
    const noisy = `a\u0000b\nc${"x".repeat(400)}`;
    const ordering = readOrdering(
      wire({ accepting: false, reason: "paused", message: noisy }),
    );
    // No C0 control characters survive (checked by code point, not by a control-character regex).
    expect(
      [...(ordering?.message ?? "")].every((ch) => ch.charCodeAt(0) > 31),
    ).toBe(true);
    expect(ordering?.message?.length).toBe(200);
    expect(
      readOrdering(wire({ accepting: false, reason: "paused", message: "   " }))
        ?.message,
    ).toBeNull();
  });

  it("drops an unparseable resume instant instead of showing garbage", () => {
    expect(
      readOrdering(
        wire({
          accepting: false,
          reason: "paused",
          resumes_at: "tomorrow-ish",
        }),
      )?.resumesAt,
    ).toBeNull();
  });

  // Fail open for display: anything that is not exactly the contract means "show nothing". The server still enforces.
  it.each([
    ["absent", undefined],
    ["null", null],
    ["a string", "paused"],
    ["an array", []],
    ["accepting missing", wire({ accepting: undefined })],
    ["accepting not a boolean", wire({ accepting: "yes" })],
    [
      "not accepting without a reason",
      wire({ accepting: false, reason: null }),
    ],
    [
      "not accepting with an unknown reason",
      wire({ accepting: false, reason: "holiday" }),
    ],
    [
      "accepting but carrying a reason",
      wire({ accepting: true, reason: "paused" }),
    ],
    ["unknown scope", wire({ min_order_scope: "pickup_only" })],
    ["missing scope", wire({ min_order_scope: undefined })],
    ["minimum as a string", wire({ min_order_minor: "15000" })],
    ["minimum zero", wire({ min_order_minor: 0 })],
    ["minimum negative", wire({ min_order_minor: -5 })],
    ["minimum fractional", wire({ min_order_minor: 10.5 })],
  ])("returns null (no notice) for %s", (_label, raw) => {
    expect(readOrdering(raw)).toBeNull();
  });
});

describe("minimumOrderView — display-only mirror of the server's minimum rule", () => {
  const base: AwjOrdering = {
    accepting: true,
    reason: null,
    message: null,
    resumesAt: null,
    minOrderMinor: 15000,
    minOrderScope: "all",
  };

  it("is null when there is no block or no minimum", () => {
    expect(minimumOrderView(null, 1000, null)).toBeNull();
    expect(
      minimumOrderView({ ...base, minOrderMinor: null }, 1000, null),
    ).toBeNull();
  });

  it("reports the exact amount still missing below the minimum", () => {
    expect(minimumOrderView(base, 12000, null)).toEqual({
      minOrderMinor: 15000,
      scope: "all",
      applies: true,
      shortfallMinor: 3000,
    });
  });

  it("reports nothing missing at or above the minimum (the boundary is met)", () => {
    expect(minimumOrderView(base, 15000, null)?.shortfallMinor).toBeNull();
    expect(minimumOrderView(base, 15001, null)?.shortfallMinor).toBeNull();
    expect(minimumOrderView(base, 14999, null)?.shortfallMinor).toBe(1);
  });

  it("applies a delivery_only minimum to delivery and to an unknown method, never to pickup", () => {
    const deliveryOnly = { ...base, minOrderScope: "delivery_only" as const };
    expect(minimumOrderView(deliveryOnly, 1000, "standard")?.applies).toBe(
      true,
    );
    expect(minimumOrderView(deliveryOnly, 1000, null)?.applies).toBe(true);
    expect(minimumOrderView(deliveryOnly, 1000, "pickup")).toMatchObject({
      applies: false,
      shortfallMinor: null,
    });
  });

  it("applies an 'all' minimum to pickup as well", () => {
    expect(minimumOrderView(base, 1000, "pickup")).toMatchObject({
      applies: true,
      shortfallMinor: 14000,
    });
  });
});

describe("isolateBidi", () => {
  it("wraps text in a first-strong isolate and leaves it otherwise untouched", () => {
    expect(isolateBidi("١٥٠٫٠٠ ر.س.")).toBe("\u2068١٥٠٫٠٠ ر.س.\u2069");
  });
});
