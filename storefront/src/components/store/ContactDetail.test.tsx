import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContactDetail, contactDetailText } from "./ContactDetail";

describe("ContactDetail", () => {
  it("keeps the text and a decorative icon, and hides a blank value", () => {
    const { rerender, container } = render(
      <ContactDetail kind="phone" value="  +966 50 000 0000  " />,
    );
    expect(screen.getByText("+966 50 000 0000")).toBeTruthy();
    expect(
      container.querySelector("[data-contact-icon='phone']"),
    ).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(contactDetailText("   ")).toBeNull();

    rerender(<ContactDetail kind="email" value="   " />);
    expect(container.querySelector("[data-contact-icon]")).toBeNull();
  });
});
