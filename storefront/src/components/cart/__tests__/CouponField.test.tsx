import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { COUPON_CAPABILITY } from "@/lib/commerce/capabilities";
import { CouponField } from "../CouponField";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

describe("CouponField — DESIGN_ONLY", () => {
  it("is declared design_only, so nothing downstream may treat it as live", () => {
    expect(COUPON_CAPABILITY).toBe("design_only");
  });

  it("answers a submitted code with the capability message and never reports a discount", async () => {
    const user = userEvent.setup();
    render(<CouponField />);

    await user.type(screen.getByLabelText("coupon.label"), "SUMMER25");
    await user.click(screen.getByRole("button", { name: "coupon.apply" }));

    expect(screen.getByRole("status")).toHaveTextContent("coupon.unavailable");
    // Nothing that could be read as an accepted code or an applied amount.
    expect(screen.queryByText(/applied/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/discount:/)).not.toBeInTheDocument();
  });

  it("refuses to submit an empty code rather than pretending to check one", async () => {
    render(<CouponField />);

    expect(screen.getByRole("button", { name: "coupon.apply" })).toBeDisabled();
  });

  it("writes nothing to browser storage — an inert control must not look like a saved preference", async () => {
    const user = userEvent.setup();
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    const cookieSpy = vi.spyOn(document, "cookie", "set");

    render(<CouponField />);
    await user.type(screen.getByLabelText("coupon.label"), "SUMMER25");
    await user.click(screen.getByRole("button", { name: "coupon.apply" }));

    expect(localSpy).not.toHaveBeenCalled();
    expect(cookieSpy).not.toHaveBeenCalled();

    localSpy.mockRestore();
    cookieSpy.mockRestore();
  });
});
