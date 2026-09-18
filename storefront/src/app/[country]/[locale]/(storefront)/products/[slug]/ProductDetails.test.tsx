import type { Product } from "@spree/sdk";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_PAGE_EXPAND } from "@/lib/data/cached";
import { ProductDetails } from "./ProductDetails";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  useStore: () => ({ currency: "USD" }),
}));

vi.mock("@/lib/analytics/gtm", () => ({
  trackAddToCart: vi.fn(),
  trackViewItem: vi.fn(),
}));

const productWithoutCustomVariants = {
  id: "product-1",
  name: "Single Variant Product",
  slug: "single-variant-product",
  default_variant_id: "variant-master",
  default_variant: {
    id: "variant-master",
    product_id: "product-1",
    sku: "MASTER-SKU-001",
    options_text: "",
    purchasable: true,
    in_stock: true,
    price: {
      display_amount: "$25.00",
      amount_in_cents: 2500,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
    original_price: null,
  },
  variants: [],
  option_types: [],
  media: [],
  purchasable: true,
  in_stock: true,
  price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
    compare_at_amount_in_cents: null,
    display_compare_at_amount: null,
  },
  original_price: null,
  description_html: null,
  custom_fields: [],
} as unknown as Product;

describe("ProductDetails", () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockSurface.current = "dtc";
  });

  it("requests the default variant for the product page", () => {
    expect(PRODUCT_PAGE_EXPAND).toContain("default_variant");
  });

  it("shows the master SKU when a product has no custom variants", () => {
    render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
      />,
    );

    expect(screen.getByText("sku")).toBeInTheDocument();
    expect(screen.getByText("MASTER-SKU-001")).toBeInTheDocument();
  });

  it("on the DTC (AWJ) surface, add-to-cart sends the real AWJ product id and base unit key — never the synthetic default-variant id", async () => {
    const user = userEvent.setup();
    render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
      />,
    );

    await user.click(screen.getByText("addToCart"));

    // The fourth argument is the variant: null for a simple product, because
    // `store/v1` treats an absent variant as "this product sells in its own
    // right". A synthetic default-variant id must never take its place.
    expect(mockAddItem).toHaveBeenCalledWith("product-1", 1, "base", null);
    expect(mockAddItem).not.toHaveBeenCalledWith(
      "variant-master",
      expect.anything(),
      expect.anything(),
    );
  });

  it("on the wholesale surface, add-to-cart still sends the Spree variant id (unchanged behavior)", async () => {
    mockSurface.current = "wholesale";
    const user = userEvent.setup();
    render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
      />,
    );

    await user.click(screen.getByText("addToCart"));

    expect(mockAddItem).toHaveBeenCalledWith("variant-master", 1);
  });
});

describe("ProductDetails — AWJ variant-managed products (STORE-UI-3)", () => {
  const optionTypes = [
    {
      id: "opt-size",
      name: "Size",
      label: "Size",
      position: 0,
      kind: "awj_generic",
    },
  ];

  const smallValue = {
    id: "val-s",
    option_type_id: "opt-size",
    name: "Small",
    label: "Small",
    position: 0,
    color_code: null,
    option_type_name: "Size",
    option_type_label: "Size",
    image_url: null,
  };
  const largeValue = {
    ...smallValue,
    id: "val-l",
    name: "Large",
    label: "Large",
    position: 1,
  };

  function variantManagedProduct(overrides: Record<string, unknown> = {}) {
    return {
      id: "product-9",
      name: "Variant Managed Product",
      slug: "variant-managed-product",
      isVariantManaged: true,
      default_variant_id: "product-9-default",
      default_variant: undefined,
      option_types: optionTypes,
      option_values: [smallValue, largeValue],
      variants: [
        {
          id: "var-small",
          product_id: "product-9",
          sku: "SKU-S",
          options_text: "Small",
          purchasable: true,
          in_stock: true,
          media: [],
          option_values: [smallValue],
          price: {
            display_amount: "$50.00",
            amount_in_cents: 5000,
            compare_at_amount_in_cents: null,
            display_compare_at_amount: null,
          },
          original_price: null,
        },
        {
          id: "var-large",
          product_id: "product-9",
          sku: "SKU-L",
          options_text: "Large",
          purchasable: false,
          in_stock: false,
          media: [],
          option_values: [largeValue],
          price: {
            display_amount: "$75.00",
            amount_in_cents: 7500,
            compare_at_amount_in_cents: null,
            display_compare_at_amount: null,
          },
          original_price: null,
        },
      ],
      media: [],
      purchasable: true,
      in_stock: true,
      price: {
        display_amount: null,
        amount_in_cents: null,
        compare_at_amount_in_cents: null,
        display_compare_at_amount: null,
      },
      original_price: null,
      description: null,
      description_html: null,
      custom_fields: [],
      categories: [],
      ...overrides,
    } as unknown as Product;
  }

  beforeEach(() => {
    mockAddItem.mockReset();
    mockSurface.current = "dtc";
  });

  it("preselects nothing, because AWJ designates no default variant", () => {
    render(
      <ProductDetails product={variantManagedProduct()} basePath="/sa/en" />,
    );

    // The action states what is required instead of offering a purchase the
    // shopper has not specified.
    expect(screen.getByText("selectOptions")).toBeInTheDocument();
    expect(screen.queryByText("addToCart")).not.toBeInTheDocument();
  });

  it("refuses to add anything until a variant is resolved", async () => {
    const user = userEvent.setup();
    render(
      <ProductDetails product={variantManagedProduct()} basePath="/sa/en" />,
    );

    await user.click(screen.getByRole("button", { name: /selectOptions/i }));

    // Never the parent id: the parent has no sellable identity.
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("shows no price of its own before a variant is chosen", () => {
    render(
      <ProductDetails product={variantManagedProduct()} basePath="/sa/en" />,
    );

    expect(screen.getByText("pricedByOption")).toBeInTheDocument();
    expect(screen.queryByText("$50.00")).not.toBeInTheDocument();
  });
});
