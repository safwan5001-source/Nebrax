import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ORDER_STATUS_CAPABILITY } from "@/lib/commerce/capabilities";
import { AccountOrderStatus } from "../AccountOrderStatus";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

describe("AccountOrderStatus — DESIGN_ONLY", () => {
  it("is declared design_only", () => {
    expect(ACCOUNT_ORDER_STATUS_CAPABILITY).toBe("design_only");
  });

  it("marks placed for a confirmed order and states tracking once, quietly", () => {
    render(<AccountOrderStatus status="confirmed" />);

    expect(screen.getByText("timeline.placed")).toBeInTheDocument();
    expect(screen.getByText("timeline.preparing")).toBeInTheDocument();
    expect(screen.getByText("timeline.onTheWay")).toBeInTheDocument();
    expect(screen.getByText("timeline.delivered")).toBeInTheDocument();
    expect(screen.getByText("timeline.caption")).toBeInTheDocument();
    expect(screen.queryByText("timeline.notTracked")).not.toBeInTheDocument();
    expect(screen.queryByText(/shipped/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/تم الشحن/)).not.toBeInTheDocument();
  });

  describe("cancelled (O3c)", () => {
    it("replaces the journey with a terminal notice — never placed/preparing/on the way", () => {
      render(
        <AccountOrderStatus status="cancelled" cancelledDate="3 May 2026" />,
      );

      expect(screen.getByText("cancelled.title")).toBeInTheDocument();
      expect(
        screen.getByText(/cancelled\.body:.*3 May 2026/),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
      for (const step of ["placed", "preparing", "onTheWay", "delivered"]) {
        expect(screen.queryByText(`timeline.${step}`)).not.toBeInTheDocument();
      }
      expect(screen.queryByText("timeline.caption")).not.toBeInTheDocument();
    });

    it("falls back to the dateless body when the API gave no timestamp", () => {
      render(<AccountOrderStatus status="cancelled" />);
      expect(screen.getByText("cancelled.bodyNoDate")).toBeInTheDocument();
    });

    it("makes no refund or payment-reversal claim", () => {
      render(<AccountOrderStatus status="cancelled" />);
      expect(screen.queryByText(/refund(ed)?\b/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/استرداد|مسترد/)).not.toBeInTheDocument();
    });

    it("leaves a confirmed order's journey untouched", () => {
      render(<AccountOrderStatus status="confirmed" />);
      expect(screen.queryByText("cancelled.title")).not.toBeInTheDocument();
      expect(screen.getByText("timeline.placed")).toBeInTheDocument();
    });
  });
});
