import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontCartLine } from "@/lib/commerce/cart-types";
import { awjCartLineView, CartLine } from "../CartLine";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

function line(overrides: Partial<StorefrontCartLine> = {}): StorefrontCartLine {
  return {
    id: "line-1",
    productId: "prod-1",
    variantId: null,
    variantDescriptor: null,
    name: "منتج تجريبي",
    unitKey: "base",
    unitName: "قطعة",
    quantity: 2,
    unitPrice: { amount_minor: 2500, currency: "SAR" },
    lineTotal: { amount_minor: 5000, currency: "SAR" },
    available: true,
    ...overrides,
  };
}

describe("CartLine", () => {
  it("prints the server's own line total rather than unit price × quantity", () => {
    // 2 × 25.00 would be 50.00 either way, so the fixture makes the two
    // disagree: only the server's `lineTotal` (99.00) may be rendered.
    render(
      <CartLine
        view={awjCartLineView(
          line({ lineTotal: { amount_minor: 9900, currency: "SAR" } }),
          "/sa/ar",
          null,
        )}
      />,
    );

    expect(screen.getByText(/٩٩/)).toBeInTheDocument();
    expect(screen.queryByText(/٥٠٫٠٠/)).not.toBeInTheDocument();
  });

  it("shows no money at all for an unavailable line, because the server zeroes both amounts", () => {
    render(
      <CartLine
        view={awjCartLineView(
          line({
            available: false,
            unitPrice: { amount_minor: 0, currency: "SAR" },
            lineTotal: { amount_minor: 0, currency: "SAR" },
          }),
          "/sa/ar",
          null,
        )}
      />,
    );

    expect(screen.getByText("itemUnavailable")).toBeInTheDocument();
    expect(screen.getByText("notAvailable")).toBeInTheDocument();
    // A zero printed as currency would read as "free".
    expect(screen.queryByText(/٠٫٠٠/)).not.toBeInTheDocument();
  });

  it("shows the backend's variant descriptor alongside the unit", () => {
    render(
      <CartLine
        view={awjCartLineView(
          line({
            variantId: "var-1",
            variantDescriptor: "١ لتر / ستانلس ستيل",
          }),
          "/sa/ar",
          null,
        )}
      />,
    );

    expect(screen.getByText("١ لتر / ستانلس ستيل")).toBeInTheDocument();
    expect(screen.getByText("قطعة")).toBeInTheDocument();
  });

  it("links an available line to its product and never links an unavailable one", () => {
    const { rerender } = render(
      <CartLine view={awjCartLineView(line(), "/sa/ar", null)} />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/sa/ar/products/prod-1",
    );

    rerender(
      <CartLine
        view={awjCartLineView(line({ available: false }), "/sa/ar", null)}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers no quantity or remove control at the read-only summary density", () => {
    render(
      <CartLine
        view={awjCartLineView(line(), "/sa/ar", null)}
        density="summary"
        onRemove={() => {}}
        onQuantityChange={() => {}}
      />,
    );

    expect(screen.queryByLabelText("quantity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/removeItemLabel/)).not.toBeInTheDocument();
  });
});
