import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishedCardStyleProvider } from "@/components/layout/PublishedCardStyle";
import { OfferCard } from "@/components/products/OfferCard";
import type { Offer } from "@/lib/commerce/offers";

const COPY: Record<string, string> = {
  offerPrice: "سعر العرض",
  offerReferencePrice: "السعر الأساسي",
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { percent?: number }) =>
    key === "offerDiscount" ? `خصم ${values?.percent}%` : (COPY[key] ?? key),
}));

const base: Offer = {
  id: "o1",
  productId: "prod-uuid-1",
  name: "هاتف ذكي",
  thumbnailUrl: null,
  referencePrice: { amountMinor: 25000, currency: "SAR", display: "250 ر.س" },
  offerPrice: { amountMinor: 19000, currency: "SAR", display: "190 ر.س" },
  discountPercent: 24,
};

function renderCard(
  overrides: Partial<Offer> = {},
  props: { basePath?: string } = {},
) {
  return render(
    <OfferCard
      offer={{ ...base, ...overrides }}
      basePath={props.basePath ?? "/sa/ar"}
    />,
  );
}

describe("OfferCard — CUST-H4-7", () => {
  it("shows the name, offer price, base price and the backend percent badge", () => {
    const { container } = renderCard();
    expect(screen.getByText("هاتف ذكي")).toBeTruthy();
    expect(container.querySelector("[data-offer-price]")?.textContent).toBe(
      "190 ر.س",
    );
    expect(container.querySelector("[data-offer-reference]")?.textContent).toBe(
      "250 ر.س",
    );
    expect(container.querySelector("[data-offer-badge]")?.textContent).toBe(
      "خصم 24%",
    );
  });

  it("prints exactly the backend percent — no recomputation from the two prices", () => {
    const { container } = renderCard({ discountPercent: 61 });
    expect(container.querySelector("[data-offer-badge]")?.textContent).toBe(
      "خصم 61%",
    );
  });

  it("draws no '0%' badge for a sub-half-percent discount, but keeps both prices", () => {
    const { container } = renderCard({ discountPercent: 0 });
    expect(container.querySelector("[data-offer-badge]")).toBeNull();
    expect(container.textContent).not.toContain("%");
    expect(container.querySelector("[data-offer-price]")).not.toBeNull();
    expect(container.querySelector("[data-offer-reference]")).not.toBeNull();
  });

  it("explains the price relationship without colour or strikethrough alone (sr-only labels)", () => {
    const { container } = renderCard();
    const srOnly = Array.from(container.querySelectorAll(".sr-only")).map(
      (el) => el.textContent,
    );
    expect(srOnly).toEqual(["سعر العرض: ", "السعر الأساسي: "]);
    expect(
      container.querySelector("[data-offer-reference]")?.parentElement
        ?.className,
    ).toContain("line-through");
  });

  it("links to the product page by its id under the locale base path — a single stretched link", () => {
    const { container } = renderCard();
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/sa/ar/products/prod-uuid-1");
    expect(links[0].className).toContain("after:absolute");
    expect(links[0].textContent).toBe("هاتف ذكي");
  });

  it("has no add-to-cart action and invents no promotional copy or savings amount", () => {
    const { container } = renderCard();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toMatch(/وفّر|وفر|save|limited|محدود/i);
  });

  it('renders the image as decorative (alt="") because the name sits right beside it, with a fallback when absent', () => {
    const withImage = renderCard({
      thumbnailUrl: "https://cdn.example.test/p.jpg",
    });
    const img = withImage.container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
    withImage.unmount();
    const without = renderCard({ thumbnailUrl: null });
    expect(without.container.querySelector("img")).toBeNull();
  });

  it("clamps long names and lets prices wrap — no horizontal overflow", () => {
    const { container } = renderCard({ name: "اسم منتج طويل جداً ".repeat(15) });
    expect(container.querySelector("h3")?.className).toContain("line-clamp-2");
    expect(container.querySelector("h3")?.className).toContain("break-words");
    expect(container.querySelector("p")?.className).toContain("flex-wrap");
    expect((container.firstChild as HTMLElement).className).toContain(
      "min-w-0",
    );
  });

  it("follows the published compact card style", () => {
    const standard = renderCard();
    const standardBody =
      standard.container.querySelector("[data-card-body]")?.className;
    standard.unmount();
    const compact = render(
      <PublishedCardStyleProvider productCard="compact">
        <OfferCard offer={base} basePath="/sa/ar" />
      </PublishedCardStyleProvider>,
    );
    expect(
      compact.container.querySelector("[data-card-body]")?.className,
    ).not.toBe(standardBody);
  });
});
