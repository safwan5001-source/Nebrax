import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY } from "@/lib/commerce/capabilities";
import { AccountPaymentMethods } from "../AccountPaymentMethods";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

describe("AccountPaymentMethods — DESIGN_ONLY", () => {
  it("is declared design_only", () => {
    expect(ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY).toBe("design_only");
  });

  it("renders intended method cards with a synthetic mask and no card fields", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    render(<AccountPaymentMethods />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByText("methodMask")).toHaveLength(2);
    expect(screen.getByText("methodExpiry")).toBeInTheDocument();
    expect(screen.getByText("savedMethod.card")).toBeInTheDocument();
    expect(screen.getByText("savedMethod.bank")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "addPaymentMethod" }));
    expect(screen.getByText("paymentActionUnavailable")).toBeInTheDocument();
    expect(screen.queryByText(/visa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mada/i)).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();

    setItem.mockRestore();
  });
});
