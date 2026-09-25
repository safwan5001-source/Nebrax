import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { StoreNotFoundState } from "../StoreNotFoundState";

vi.mock("next-intl", () => ({
  useLocale: () => "ar",
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

describe("StoreNotFoundState", () => {
  it("links back to the store home and does not invent a catalog", () => {
    render(<StoreNotFoundState />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "notFound.title",
    );
    expect(screen.getByText("notFound.description")).toBeInTheDocument();
    const home = screen.getByRole("link", { name: /notFound.home/ });
    expect(home).toHaveAttribute("href", "/sa/ar");
    expect(screen.queryByText(/ر\.س|SAR|\$/)).not.toBeInTheDocument();
  });

  it("has Arabic and English copy without a product or price claim", () => {
    expect(ar.notFound.title).toBe("الصفحة غير موجودة");
    expect(ar.notFound.home).toBe("العودة إلى المتجر");
    expect(en.notFound.title).toBe("Page not found");
    expect(en.notFound.description).not.toMatch(/product|price|\$/i);
    expect(ar.notFound.description).not.toMatch(/سعر|منتج/);
  });
});
