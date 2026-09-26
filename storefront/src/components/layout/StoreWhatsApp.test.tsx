import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreWhatsApp } from "./StoreWhatsApp";

describe("StoreWhatsApp", () => {
  it("is an accessible wa.me link and does not claim to send a message", () => {
    render(
      <StoreWhatsApp
        href="https://wa.me/966500000000"
        label="Contact on WhatsApp"
      />,
    );
    const link = screen.getByRole("link", { name: "Contact on WhatsApp" });

    expect(link.getAttribute("href")).toBe("https://wa.me/966500000000");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
