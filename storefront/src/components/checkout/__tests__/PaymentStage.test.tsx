import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaymentStage } from "@/components/checkout/awj/PaymentStage";
import { PAYMENT_CAPABILITY } from "@/lib/commerce/capabilities";

const t = ((key: string) => key) as unknown as Parameters<
  typeof PaymentStage
>[0]["t"];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("PaymentStage — DESIGN_ONLY", () => {
  it("is declared design_only", () => {
    expect(PAYMENT_CAPABILITY).toBe("design_only");
  });

  it("states plainly that online payment is not enabled", () => {
    render(<PaymentStage t={t} />);

    expect(screen.getByText("payment.notEnabledTitle")).toBeInTheDocument();
    expect(screen.getByText("payment.notEnabledBody")).toBeInTheDocument();
  });

  it("offers no selectable payment method — the shapes are marked not enabled", () => {
    render(<PaymentStage t={t} />);

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByText("payment.notEnabledBadge")).toHaveLength(3);
  });

  it("collects no card data", () => {
    const { container } = render(<PaymentStage t={t} />);

    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });
});
