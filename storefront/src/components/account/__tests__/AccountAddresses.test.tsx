import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ADDRESSES_CAPABILITY } from "@/lib/commerce/capabilities";
import { AccountAddresses } from "../AccountAddresses";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

describe("AccountAddresses — DESIGN_ONLY", () => {
  it("is declared design_only", () => {
    expect(ACCOUNT_ADDRESSES_CAPABILITY).toBe("design_only");
  });

  it("renders the intended address-book cards", () => {
    render(<AccountAddresses />);
    expect(screen.getByText("addressFixture.name")).toBeInTheDocument();
    expect(screen.getByText("addressFixture.line1")).toBeInTheDocument();
    expect(screen.getByText("addressFixture.cityPostal")).toBeInTheDocument();
    expect(screen.getByText("addressFixtureAlt.line1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "editAddress" })).toHaveLength(
      2,
    );
    expect(
      screen.getAllByRole("button", { name: "removeAddress" }),
    ).toHaveLength(2);
  });

  it("refuses add/edit/remove without reporting success or writing storage", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookieSpy = vi.spyOn(document, "cookie", "set");

    render(<AccountAddresses />);

    await user.click(screen.getByRole("button", { name: "addNewAddress" }));
    expect(screen.getByText("addressActionUnavailable")).toBeInTheDocument();
    expect(screen.queryByText(/saved successfully/i)).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(cookieSpy).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "editAddress" })[0]);
    expect(setItem).not.toHaveBeenCalled();
    expect(cookieSpy).not.toHaveBeenCalled();

    setItem.mockRestore();
    cookieSpy.mockRestore();
  });
});
