import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_GIFT_ORDER_PREVIEW,
  ACCOUNT_ORDER_PREVIEW,
} from "@/lib/commerce/account-preview";
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
  CartLine: ({
    view,
  }: {
    view: { lineTotalLabel: string; addon: boolean };
  }) => (
    <div data-line data-addon={view.addon ? "true" : undefined}>
      {view.lineTotalLabel}
    </div>
  ),
  awjOrderLineView: (item: {
    lineTotal: { amount_minor: number; currency: string };
    addonOf: string | null;
  }) => ({
    lineTotalLabel: formatMinorAmount(item.lineTotal),
    addon: item.addonOf !== null,
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

  describe("gifting (FLOWERS-H13)", () => {
    it("shows the stored delivery date, window and gift card", () => {
      render(
        <AccountOrderDetail
          order={ACCOUNT_GIFT_ORDER_PREVIEW}
          basePath="/sa/ar"
        />,
      );
      const block = document.querySelector("[data-order-gifting]");
      expect(block).not.toBeNull();
      const text = block?.textContent ?? "";
      expect(text).toContain("success.scheduleHeading");
      expect(text).toContain("مساءً");
      expect(text).toContain("success.giftHeading");
      expect(text).toContain("ريم الحربي");
      expect(text).toContain("+966555550101");
      expect(text).toContain("كل عام وأنتِ بخير");
      expect(text).toContain("نورة");
    });

    it("hides the sender when the order was anonymous", () => {
      render(
        <AccountOrderDetail
          order={{
            ...ACCOUNT_GIFT_ORDER_PREVIEW,
            gift: {
              ...ACCOUNT_GIFT_ORDER_PREVIEW.gift!,
              hideSender: true,
            },
          }}
          basePath="/sa/ar"
        />,
      );
      const text =
        document.querySelector("[data-order-gifting]")?.textContent ?? "";
      expect(text).toContain("review.giftAnonymous");
      expect(text).not.toContain("نورة");
    });

    it("renders nothing extra for an order without a gift or a date", () => {
      render(
        <AccountOrderDetail order={ACCOUNT_ORDER_PREVIEW} basePath="/sa/ar" />,
      );
      expect(document.querySelector("[data-order-gifting]")).toBeNull();
    });

    it("keeps an add-on under its own bouquet, not in creation order", () => {
      const [bouquet, addon] = ACCOUNT_GIFT_ORDER_PREVIEW.items;
      const other = ACCOUNT_ORDER_PREVIEW.items[0];
      render(
        <AccountOrderDetail
          order={{
            ...ACCOUNT_GIFT_ORDER_PREVIEW,
            // The API lists lines by creation time: bouquet, other, add-on.
            items: [bouquet, other, addon],
          }}
          basePath="/sa/ar"
        />,
      );
      const rows = Array.from(document.querySelectorAll("[data-line]")).map(
        (el) => el.getAttribute("data-addon") === "true",
      );
      // bouquet, its add-on, then the unrelated line.
      expect(rows).toEqual([false, true, false]);
    });
  });
});
