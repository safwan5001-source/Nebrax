import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ORDER_STATUS_CAPABILITY } from "@/lib/commerce/capabilities";
import { AccountOrderStatus } from "../AccountOrderStatus";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("AccountOrderStatus — DESIGN_ONLY", () => {
  it("is declared design_only", () => {
    expect(ACCOUNT_ORDER_STATUS_CAPABILITY).toBe("design_only");
  });

  it("marks placed for a confirmed order and does not claim shipped or delivered", () => {
    render(<AccountOrderStatus status="confirmed" />);

    expect(screen.getByText("timeline.placed")).toBeInTheDocument();
    expect(screen.getAllByText("timeline.notTracked").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/shipped/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/تم الشحن/)).not.toBeInTheDocument();
  });
});
