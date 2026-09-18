import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ORDER_PREVIEW } from "@/lib/commerce/account-preview";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import { AccountOrderDetail } from "../AccountOrderDetail";

vi.mock("next-intl", () => ({
  useLocale: () => "ar",
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

vi.mock("@/hooks/useCartLineImages", () => ({
  useCartLineImages: () => ({}),
}));

vi.mock("@/components/cart/CartLine", () => ({
  CartLine: ({ view }: { view: { lineTotalLabel: string } }) => (
    <div>{view.lineTotalLabel}</div>
  ),
  awjOrderLineView: (item: {
    lineTotal: { amount_minor: number; currency: string };
  }) => ({
    lineTotalLabel: formatMinorAmount(item.lineTotal),
  }),
}));

describe("AccountOrderDetail", () => {
  it("shows the authoritative line total, not unit price times quantity", () => {
    const line = ACCOUNT_ORDER_PREVIEW.items[1];
    const multiplied = line.unitPrice.amount_minor * line.quantity;
    expect(multiplied).not.toBe(line.lineTotal.amount_minor);

    render(
      <AccountOrderDetail order={ACCOUNT_ORDER_PREVIEW} basePath="/sa/ar" />,
    );

    const text = (document.body.textContent ?? "").replace(/\s/g, "");
    expect(text).toContain(
      formatMinorAmount(line.lineTotal).replace(/\s/g, ""),
    );
    expect(text).toContain(
      formatMinorAmount(ACCOUNT_ORDER_PREVIEW.total).replace(/\s/g, ""),
    );
    expect(text).not.toContain(
      formatMinorAmount({
        amount_minor: multiplied,
        currency: "SAR",
      }).replace(/\s/g, ""),
    );
  });

  it("does not offer an invoice or receipt download", () => {
    render(
      <AccountOrderDetail order={ACCOUNT_ORDER_PREVIEW} basePath="/sa/ar" />,
    );
    expect(screen.queryByText(/invoice/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();
  });
});
