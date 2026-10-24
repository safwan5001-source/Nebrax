import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FooterPaymentLogos } from "./FooterPaymentLogos";

const base = {
  enabled: true,
  brands: ["visa", "mada", "apple_pay", "mastercard"] as const,
  style: "cards" as const,
  size: "md" as const,
  showTitle: true,
};

describe("FooterPaymentLogos", () => {
  it("is opt-in and preserves selected order without stretching assets", () => {
    const { container, rerender } = render(
      <FooterPaymentLogos settings={undefined} title="Payment methods" />,
    );
    expect(container.firstChild).toBeNull();
    rerender(
      <FooterPaymentLogos
        settings={{ ...base, brands: [...base.brands] }}
        title="Payment methods"
      />,
    );
    expect(
      screen.getByRole("region", { name: "Payment methods" }),
    ).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll("img")).map((img) =>
        img.getAttribute("src"),
      ),
    ).toEqual([
      "/payment-brands/visa.svg",
      "/payment-brands/mada.svg",
      "/payment-brands/apple-pay.svg",
      "/payment-brands/mastercard.svg",
    ]);
    for (const img of container.querySelectorAll("img"))
      expect(img.className).toContain("w-auto");
  });

  it("supports all three styles and sizes, including a no-wrap overflow-safe strip", () => {
    for (const style of ["inline", "cards", "strip"] as const) {
      for (const size of ["sm", "md", "lg"] as const) {
        const { container } = render(
          <FooterPaymentLogos
            settings={{ ...base, brands: [...base.brands], style, size }}
            title="Payment methods"
          />,
        );
        const block = container.querySelector(
          "[data-footer-payment-logos]",
        ) as HTMLElement;
        expect(block.dataset.paymentLogoStyle).toBe(style);
        expect(block.dataset.paymentLogoSize).toBe(size);
        if (style === "strip") {
          expect(block.querySelector(".overflow-x-auto")).not.toBeNull();
          expect(block.querySelector(".flex-nowrap")).not.toBeNull();
        }
        cleanup();
      }
    }
  });

  it("can hide only the visible title while retaining the accessible group name", () => {
    render(
      <FooterPaymentLogos
        settings={{ ...base, brands: [...base.brands], showTitle: false }}
        title="Payment methods"
      />,
    );
    expect(
      screen.getByRole("region", { name: "Payment methods" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Payment methods" }),
    ).toBeNull();
  });

  it("keeps configured order in both LTR and RTL containers using logical alignment", () => {
    for (const dir of ["ltr", "rtl"] as const) {
      const { container } = render(
        <div dir={dir}>
          <FooterPaymentLogos
            settings={{ ...base, brands: [...base.brands] }}
            title="Payment methods"
            align="end"
          />
        </div>,
      );
      expect(
        Array.from(container.querySelectorAll("img")).map((img) =>
          img.getAttribute("alt"),
        ),
      ).toEqual(["Visa", "mada", "Apple Pay", "Mastercard"]);
      const block = container.querySelector(
        "[data-footer-payment-logos]",
      ) as HTMLElement;
      expect(block.className).toContain("text-end");
      expect(block.className).not.toMatch(/text-(left|right)/);
      cleanup();
    }
  });
});
