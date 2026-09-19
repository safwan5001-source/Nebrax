import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ORDER_PREVIEW } from "@/lib/commerce/account-preview";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import { AccountOrderList } from "../AccountOrderList";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

describe("AccountOrderList", () => {
  it("prints the server total rather than multiplying line prices", () => {
    const multipliedMinor = ACCOUNT_ORDER_PREVIEW.items.reduce(
      (sum, item) => sum + item.unitPrice.amount_minor * item.quantity,
      0,
    );
    expect(multipliedMinor).not.toBe(ACCOUNT_ORDER_PREVIEW.total.amount_minor);

    render(
      <AccountOrderList orders={[ACCOUNT_ORDER_PREVIEW]} basePath="/sa/en" />,
    );

    const text = (document.body.textContent ?? "").replace(/\s/g, "");
    expect(text).toContain(
      formatMinorAmount(ACCOUNT_ORDER_PREVIEW.total).replace(/\s/g, ""),
    );
    expect(text.replace(/\s/g, "")).not.toContain(
      formatMinorAmount({
        amount_minor: multipliedMinor,
        currency: "SAR",
      }).replace(/\s/g, ""),
    );
  });

  it("never labels the order an invoice", () => {
    render(
      <AccountOrderList orders={[ACCOUNT_ORDER_PREVIEW]} basePath="/sa/en" />,
    );
    expect(screen.queryByText(/invoice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/فاتورة/)).not.toBeInTheDocument();
  });

  it("shows the gated notice and no fabricated orders when lookup is unavailable", () => {
    render(
      <AccountOrderList orders={[]} basePath="/sa/ar" lookupUnavailable />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "lookupUnavailableTitle",
    );
    expect(
      screen.queryByRole("link", { name: /AWJ-/ }),
    ).not.toBeInTheDocument();
  });
});
