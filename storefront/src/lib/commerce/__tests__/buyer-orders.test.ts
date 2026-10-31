import { describe, expect, it } from "vitest";
import {
  buyerOrderDetailFromApi,
  buyerOrderSummaryFromApi,
  formatBuyerMoney,
  membershipGateStatusFromError,
} from "../wholesale-buyer";

const summary = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "CORD-2026-00001",
  status: "confirmed",
  delivery_method: "pickup",
  total: { amount_minor: 1600, currency: "SAR" },
  created_at: "2026-10-31T10:00:00+03:00",
};

describe("membershipGateStatusFromError (H6 Batch M)", () => {
  it("reads the buyer's own state from a 403 only", () => {
    for (const status of ["none", "pending", "rejected", "suspended"]) {
      expect(
        membershipGateStatusFromError({
          status: 403,
          details: { membership_status: status },
        }),
      ).toBe(status);
    }
  });

  it("ignores anything unrecognised, other statuses and malformed errors", () => {
    expect(
      membershipGateStatusFromError({
        status: 403,
        details: { membership_status: "approved" },
      }),
    ).toBeNull();
    expect(
      membershipGateStatusFromError({
        status: 401,
        details: { membership_status: "pending" },
      }),
    ).toBeNull();
    expect(membershipGateStatusFromError({ status: 403 })).toBeNull();
    expect(membershipGateStatusFromError(null)).toBeNull();
    expect(membershipGateStatusFromError("x")).toBeNull();
  });
});

describe("buyer order mappers", () => {
  it("maps a summary and drops malformed rows instead of half-rendering them", () => {
    expect(buyerOrderSummaryFromApi(summary)).toMatchObject({
      id: summary.id,
      number: "CORD-2026-00001",
      totalMinor: 1600,
      currency: "SAR",
      deliveryMethod: "pickup",
      cancelledAt: null,
    });
    expect(buyerOrderSummaryFromApi({ ...summary, id: undefined })).toBeNull();
    expect(
      buyerOrderSummaryFromApi({ ...summary, total: { amount_minor: "16" } }),
    ).toBeNull();
    expect(buyerOrderSummaryFromApi(null)).toBeNull();
    expect(buyerOrderSummaryFromApi([])).toBeNull();
  });

  it("marks a cancelled order and keeps only the public cancellation time", () => {
    const row = buyerOrderSummaryFromApi({
      ...summary,
      status: "cancelled",
      cancellation: { cancelled_at: "2026-11-01T09:00:00Z", reason: "secret" },
    });
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelledAt).toBe("2026-11-01T09:00:00Z");
    expect(JSON.stringify(row)).not.toContain("secret");
  });

  it("maps the detail from public fields only and ignores everything else", () => {
    const detail = buyerOrderDetailFromApi({
      ...summary,
      invoice_id: "internal-invoice",
      partner_id: "internal-partner",
      items: [
        {
          product_name: "صنف جملة",
          unit_name: "piece",
          quantity: 2,
          unit_price: { amount_minor: 500, currency: "SAR" },
          line_total: { amount_minor: 1000, currency: "SAR" },
          price_list_id: "internal-list",
        },
        { product_name: "broken", quantity: 1 },
      ],
      delivery: {
        street: "الملك فهد",
        district: "الشاطئ",
        city: "الدمام",
        postal_code: "31411",
        amount: { amount_minor: 0, currency: "SAR" },
      },
      payment: { payment_method_name: "الدفع عند الاستلام", status: "x" },
    });

    expect(detail?.lines).toEqual([
      {
        name: "صنف جملة",
        unitName: "piece",
        quantity: 2,
        unitPriceMinor: 500,
        lineTotalMinor: 1000,
      },
    ]);
    expect(detail?.deliveryAddress).toBe("الملك فهد، الشاطئ، الدمام، 31411");
    expect(detail?.paymentMethodName).toBe("الدفع عند الاستلام");
    const blob = JSON.stringify(detail);
    for (const secret of [
      "internal-invoice",
      "internal-partner",
      "internal-list",
    ]) {
      expect(blob).not.toContain(secret);
    }
  });

  it("formats minor units in the visitor's locale and never as a float input", () => {
    expect(formatBuyerMoney(1600, "SAR", "en")).toMatch(/16\.00/);
    expect(formatBuyerMoney(50, "SAR", "en")).toMatch(/0\.50/);
    expect(formatBuyerMoney(1234, "NOT-A-CURRENCY", "en")).toBe(
      "12.34 NOT-A-CURRENCY",
    );
  });
});
