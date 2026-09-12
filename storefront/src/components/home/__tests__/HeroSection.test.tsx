import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const t = (key: string, values?: { storeName?: string }) => {
      if (key === "welcome") return values?.storeName ?? "";
      if (key === "heroDescription")
        return `Browse the published catalog for ${values?.storeName}.`;
      if (key === "shopNow") return "Shop all products";
      if (key === "identityFallback") return "Store";
      if (key === "welcomeEyebrow") return "Welcome";
      return key;
    };
    return t;
  }),
}));

describe("HeroSection (COM-7-P3A)", () => {
  it("renders the resolved store name and has no Spree demo links", async () => {
    const { HeroSection } = await import("../HeroSection");
    const element = await HeroSection({
      basePath: "/sa/ar",
      locale: "ar",
      storeName: "شركة دمينة للاستيراد والتصدير",
    });
    const { getByText, container } = render(element);

    expect(getByText("شركة دمينة للاستيراد والتصدير")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Fork on GitHub/i);
    expect(container.textContent).not.toMatch(/Quickstart/i);
    expect(container.innerHTML).not.toMatch(/github.com\/spree/);
    expect(container.innerHTML).not.toMatch(/spreecommerce.org/);
    expect(container.querySelector('a[href="/sa/ar/products"]')).toBeTruthy();
  });

  it("uses the generic fallback when the resolved name is missing", async () => {
    const { HeroSection } = await import("../HeroSection");
    const element = await HeroSection({
      basePath: "/sa/en",
      locale: "en",
      storeName: null,
    });
    const { getByText, queryByText } = render(element);

    expect(getByText("Store")).toBeTruthy();
    expect(queryByText("Spree Store")).toBeNull();
  });
});
