import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CartSummary } from "../CartSummary";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

describe("CartSummary", () => {
  it("renders the server's subtotal and no total, because the API sends no total", () => {
    render(
      <CartSummary
        subtotal={{ amount_minor: 12345, currency: "SAR" }}
        itemCount={3}
      />,
    );

    // 12345 minor units = 123.45, printed verbatim.
    expect(screen.getAllByText(/١٢٣٫٤٥/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("subtotal").length).toBeGreaterThan(0);
    expect(screen.queryByText("total")).not.toBeInTheDocument();
    expect(
      screen.getByText("summary.totalConfirmedOnPlacement"),
    ).toBeInTheDocument();
  });

  it("shows neither a tax row nor a discount row — the API carries no such figure", () => {
    render(
      <CartSummary
        subtotal={{ amount_minor: 12345, currency: "SAR" }}
        itemCount={3}
      />,
    );

    expect(screen.queryByText("tax")).not.toBeInTheDocument();
    expect(screen.queryByText("discount")).not.toBeInTheDocument();
  });

  it("never presents the unpriced delivery as free", () => {
    render(
      <CartSummary
        subtotal={{ amount_minor: 12345, currency: "SAR" }}
        itemCount={1}
        deliveryLabel="pickup · delivery.amountPending"
      />,
    );

    expect(screen.getByText(/amountPending/)).toBeInTheDocument();
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/مجاني/)).not.toBeInTheDocument();
  });
});
