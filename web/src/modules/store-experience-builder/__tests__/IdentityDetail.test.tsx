/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityDetail } from "../IdentityDetail";

describe("IdentityDetail", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the label and value beside a decorative utility icon", () => {
    const { container } = render(
      <IdentityDetail kind="vat" label="VAT number" value="  310123456700003  " />,
    );
    const icon = container.querySelector("[data-identity-icon='vat']");

    expect(screen.getByText("VAT number: 310123456700003")).toBeTruthy();
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("hides the CR row and icon when the value is blank", () => {
    const { container } = render(
      <IdentityDetail kind="cr" label="Commercial registration" value="" />,
    );

    expect(container.querySelector("[data-identity-detail]")).toBeNull();
    expect(container.querySelector("[data-identity-icon]")).toBeNull();
    expect(screen.queryByText(/Commercial registration/)).toBeNull();
  });
});
