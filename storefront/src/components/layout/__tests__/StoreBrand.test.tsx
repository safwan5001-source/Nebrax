import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreBrand } from "../StoreBrand";

describe("StoreBrand", () => {
  it("uses the typographic fallback when no logo is supplied", () => {
    render(<StoreBrand href="/sa/ar" name="متجر النور" />);
    expect(
      screen.getByRole("link", { name: "متجر النور" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a safe merchant logo without substituting AWJ branding", () => {
    render(
      <StoreBrand
        href="/sa/ar"
        name="متجر النور"
        logoUrl="data:image/png;base64,iVBORw0KGgo="
      />,
    );
    const image = screen.getByRole("img", { name: "متجر النور" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(screen.queryByText("أَوْج")).not.toBeInTheDocument();
  });

  it("ignores an unsafe logo URL and keeps the wordmark", () => {
    render(
      <StoreBrand
        href="/sa/ar"
        name="متجر النور"
        logoUrl="javascript:alert(1)"
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("متجر النور")).toBeInTheDocument();
  });
});
