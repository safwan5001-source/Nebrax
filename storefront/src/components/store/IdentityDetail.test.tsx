import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IdentityDetail, identityDetailText } from "./IdentityDetail";

describe("IdentityDetail", () => {
  it("keeps the label and value beside a decorative utility icon", () => {
    const { container } = render(
      <IdentityDetail
        kind="cr"
        label="Commercial registration"
        value="  7050247977  "
      />,
    );
    const icon = container.querySelector("[data-identity-icon='cr']");

    expect(
      screen.getByText("Commercial registration: 7050247977"),
    ).toBeTruthy();
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(identityDetailText("   ")).toBeNull();
  });

  it("hides the VAT row and icon when the value is blank", () => {
    const { container } = render(
      <IdentityDetail kind="vat" label="VAT number" value="   " />,
    );

    expect(container.querySelector("[data-identity-detail]")).toBeNull();
    expect(container.querySelector("[data-identity-icon]")).toBeNull();
    expect(screen.queryByText(/VAT number/)).toBeNull();
  });
});
