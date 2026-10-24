import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingOnlinePayment,
  PENDING_PAYMENT_TTL_MS,
  readPendingOnlinePayment,
  savePendingOnlinePayment,
} from "../pending-online-payment";

describe("pending online payment storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips the order id, reference and number — and nothing else", () => {
    savePendingOnlinePayment(
      { orderId: "o", orderReference: "r", orderNumber: "N-1" },
      1000,
    );
    expect(readPendingOnlinePayment(1500)).toEqual({
      orderId: "o",
      orderReference: "r",
      orderNumber: "N-1",
      savedAt: 1000,
    });
    const raw = JSON.parse(
      window.localStorage.getItem("awj.pendingOnlinePayment.v1") ?? "{}",
    );
    expect(Object.keys(raw).sort()).toEqual([
      "orderId",
      "orderNumber",
      "orderReference",
      "savedAt",
    ]);
  });

  it("expires on its own so a shared device does not keep the reference", () => {
    savePendingOnlinePayment(
      { orderId: "o", orderReference: "r", orderNumber: null },
      0,
    );
    expect(readPendingOnlinePayment(PENDING_PAYMENT_TTL_MS + 1)).toBeNull();
    expect(
      window.localStorage.getItem("awj.pendingOnlinePayment.v1"),
    ).toBeNull();
  });

  it("treats a corrupt value as absent and removes it", () => {
    window.localStorage.setItem("awj.pendingOnlinePayment.v1", "{not json");
    expect(readPendingOnlinePayment()).toBeNull();
    expect(
      window.localStorage.getItem("awj.pendingOnlinePayment.v1"),
    ).toBeNull();
  });

  it("clear removes it", () => {
    savePendingOnlinePayment({
      orderId: "o",
      orderReference: "r",
      orderNumber: null,
    });
    clearPendingOnlinePayment();
    expect(readPendingOnlinePayment()).toBeNull();
  });

  it("reports failure when storage is blocked so the checkout can start the payment inline instead of stranding the order", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(
      savePendingOnlinePayment({
        orderId: "o",
        orderReference: "r",
        orderNumber: null,
      }),
    ).toBe(false);
    spy.mockRestore();
  });

  it("outlives the longest payment hold the API allows (24h)", () => {
    expect(PENDING_PAYMENT_TTL_MS).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});
