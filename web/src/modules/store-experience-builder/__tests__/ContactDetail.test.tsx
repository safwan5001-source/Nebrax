/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContactDetail } from "../ContactDetail";

describe("ContactDetail", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the text beside a decorative icon and hides a blank value", () => {
    const { rerender, container } = render(
      <ContactDetail kind="hours" value="  9–5  " />,
    );
    expect(screen.getByText("9–5")).toBeTruthy();
    expect(
      container.querySelector("[data-contact-icon='hours']"),
    ).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();

    rerender(<ContactDetail kind="address" value="" />);
    expect(container.querySelector("[data-contact-icon]")).toBeNull();
  });
});
