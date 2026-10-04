import type { Product } from "@spree/sdk";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PRODUCT_GIFTING,
  type ProductGifting,
} from "@/lib/commerce/pdp-gifting";
import { ProductDetails } from "./ProductDetails";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}|${Object.values(values).join("|")}` : key,
  useLocale: () => "en",
}));
vi.mock("@/components/products/MediaGallery", () => ({
  MediaGallery: () => null,
}));
vi.mock("@/components/products/ProductCustomFields", () => ({
  ProductCustomFields: () => null,
}));

const mockAddItem = vi.fn();
const mockSurface = { current: "dtc" as "dtc" | "wholesale" };
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ addItem: mockAddItem, surface: mockSurface.current }),
}));
vi.mock("@/contexts/HiddenPricingContext", () => ({
  useHiddenPricing: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ currency: "SAR" }),
}));
vi.mock("@/lib/analytics/gtm", () => ({
  trackAddToCart: vi.fn(),
  trackViewItem: vi.fn(),
}));

const UUID_A = "0a1b2c3d-1111-4222-8333-444455556666";

function product(gifting: ProductGifting | undefined): Product {
  return {
    id: "product-1",
    name: "Rose bouquet",
    slug: "rose-bouquet",
    default_variant_id: "product-1-default",
    default_variant: {
      id: "product-1-default",
      product_id: "product-1",
      sku: "SKU-1",
      options_text: "",
      purchasable: true,
      in_stock: true,
      price: { display_amount: "SAR 120.00", amount_in_cents: 12000 },
      original_price: null,
    },
    variants: [],
    option_types: [],
    media: [],
    purchasable: true,
    in_stock: true,
    price: { display_amount: "SAR 120.00", amount_in_cents: 12000 },
    original_price: null,
    description: "Fresh roses",
    description_html: null,
    custom_fields: [],
    ...(gifting ? { gifting } : {}),
  } as unknown as Product;
}

const gifting: ProductGifting = {
  personalization: [
    {
      key: "card_text",
      type: "text",
      label: "Card text",
      helpText: "Shown on the card",
      required: true,
      maxLength: 20,
      options: [],
    },
    {
      key: "vase",
      type: "select",
      label: "Vase colour",
      helpText: null,
      required: false,
      maxLength: null,
      options: [
        { valueKey: "white", label: "White" },
        { valueKey: "black", label: "Black" },
      ],
    },
  ],
  contentBlocks: [
    { type: "care", body: "Trim the stems." },
    { type: "allergens", body: "Pollen." },
  ],
  addons: [
    {
      productId: UUID_A,
      variantId: null,
      name: "Chocolates",
      amountMinor: 4500,
      currency: "SAR",
      inStock: true,
      maxQuantity: 3,
      thumbnailUrl: null,
    },
    {
      productId: "1a1b2c3d-1111-4222-8333-444455556666",
      variantId: null,
      name: "Teddy",
      amountMinor: 9000,
      currency: "SAR",
      inStock: false,
      maxQuantity: 1,
      thumbnailUrl: null,
    },
  ],
  deliveryPromise: {
    deliverable: true,
    sameDay: true,
    earliest: { date: "2026-10-05", startTime: "19:00", endTime: "22:00" },
  },
};

describe("ProductDetails — gifting blocks (FLOWERS-H11)", () => {
  beforeEach(() => {
    mockAddItem.mockReset();
    mockSurface.current = "dtc";
  });

  it("renders nothing extra for a product without gifting (existing PDPs unchanged)", () => {
    render(
      <ProductDetails
        product={product(EMPTY_PRODUCT_GIFTING)}
        basePath="/sa/en"
      />,
    );
    expect(document.querySelector("[data-personalization]")).toBeNull();
    expect(document.querySelector("[data-addons]")).toBeNull();
    expect(document.querySelector("[data-content-blocks]")).toBeNull();
    expect(document.querySelector("[data-delivery-promise]")).toBeNull();
  });

  it("renders the promise, personalization, add-ons and information when present", () => {
    render(<ProductDetails product={product(gifting)} basePath="/sa/en" />);
    expect(
      document.querySelector('[data-delivery-promise="available"]')
        ?.textContent,
    ).toContain("deliveryPromiseToday");
    expect(screen.getByLabelText(/Card text/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Vase colour/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-addon]")).toHaveLength(2);
    const info = document.querySelector("[data-content-blocks]") as HTMLElement;
    expect(within(info).getByText("Trim the stems.")).toBeInTheDocument();
    expect(within(info).getByText("Pollen.")).toBeInTheDocument();
  });

  it("blocks add-to-cart while a required field is empty, points at it, and never calls the cart", async () => {
    const user = userEvent.setup();
    render(<ProductDetails product={product(gifting)} basePath="/sa/en" />);
    await user.click(screen.getByText("addToCart"));
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "personalizationFieldRequired",
    );
    expect(screen.getByLabelText(/Card text/)).toHaveFocus();
    expect(screen.getByLabelText(/Card text/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("sends the answers and chosen add-ons (ids + quantities only, no prices) with the cart line", async () => {
    const user = userEvent.setup();
    render(<ProductDetails product={product(gifting)} basePath="/sa/en" />);
    await user.type(screen.getByLabelText(/Card text/), "Happy birthday");
    await user.selectOptions(screen.getByLabelText(/Vase colour/), "black");
    await user.click(screen.getByLabelText("addonAdd|Chocolates"));
    await user.selectOptions(
      screen.getByLabelText("addonQuantity|Chocolates"),
      "2",
    );
    await user.click(screen.getByText("addToCart"));

    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem).toHaveBeenCalledWith("product-1", 1, "base", null, {
      personalization: { card_text: "Happy birthday", vase: "black" },
      addons: [{ productId: UUID_A, variantId: null, quantity: 2 }],
    });
  });

  it("an unavailable add-on cannot be selected", () => {
    render(<ProductDetails product={product(gifting)} basePath="/sa/en" />);
    expect(screen.getByLabelText("addonAdd|Teddy")).toBeDisabled();
  });

  it("enforces the field's max length in the input", async () => {
    const user = userEvent.setup();
    render(<ProductDetails product={product(gifting)} basePath="/sa/en" />);
    const input = screen.getByLabelText(/Card text/) as HTMLInputElement;
    await user.type(input, "x".repeat(40));
    expect(input.value).toHaveLength(20);
  });

  it("a product with only optional inputs adds straight away and sends nothing extra when none were chosen", async () => {
    const optionalOnly: ProductGifting = {
      ...EMPTY_PRODUCT_GIFTING,
      personalization: [{ ...gifting.personalization[1] }],
    };
    const user = userEvent.setup();
    render(
      <ProductDetails product={product(optionalOnly)} basePath="/sa/en" />,
    );
    await user.click(screen.getByText("addToCart"));
    expect(mockAddItem).toHaveBeenCalledWith(
      "product-1",
      1,
      "base",
      null,
      undefined,
    );
  });

  it("states the earliest non-same-day delivery as a plain date, and a neutral line when not deliverable", () => {
    const later: ProductGifting = {
      ...EMPTY_PRODUCT_GIFTING,
      deliveryPromise: {
        deliverable: true,
        sameDay: false,
        earliest: { date: "2026-10-06", startTime: "10:00", endTime: "13:00" },
      },
    };
    const { unmount } = render(
      <ProductDetails product={product(later)} basePath="/sa/en" />,
    );
    expect(
      document.querySelector("[data-delivery-promise]")?.textContent,
    ).toMatch(
      /deliveryPromiseEarliest\|Tuesday, 6 October|deliveryPromiseEarliest\|Tuesday 6 October|deliveryPromiseEarliest\|.*October/,
    );
    unmount();
    const none: ProductGifting = {
      ...EMPTY_PRODUCT_GIFTING,
      deliveryPromise: { deliverable: false, sameDay: false, earliest: null },
    };
    render(<ProductDetails product={product(none)} basePath="/sa/en" />);
    expect(
      document.querySelector('[data-delivery-promise="unavailable"]'),
    ).not.toBeNull();
  });

  it("ignores gifting data on the wholesale surface", () => {
    mockSurface.current = "wholesale";
    render(<ProductDetails product={product(gifting)} basePath="/sa/en" />);
    expect(document.querySelector("[data-personalization]")).toBeNull();
    expect(document.querySelector("[data-addons]")).toBeNull();
    expect(document.querySelector("[data-delivery-promise]")).toBeNull();
  });
});
