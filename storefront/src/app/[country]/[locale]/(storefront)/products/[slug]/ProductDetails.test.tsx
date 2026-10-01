import type { Product } from "@spree/sdk";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { PRODUCT_PAGE_EXPAND } from "@/lib/data/cached";
import type { PagePresentation } from "@/lib/presentation/page-regions";
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

describe("ProductDetails — AWJ Market mobile purchase bar", () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockSurface.current = "dtc";
  });

  it("pins the existing quantity/add-to-cart row to the bottom below the desktop breakpoint", () => {
    render(
      <PublishedThemeMarkerProvider themePreset="awj-market">
        <ProductDetails
          product={productWithoutCustomVariants}
          basePath="/us/en"
        />
      </PublishedThemeMarkerProvider>,
    );

    // Same control, not a duplicate: exactly one add-to-cart button exists,
    // just repositioned by CSS for the simulated/mobile breakpoint.
    expect(screen.getAllByText("addToCart")).toHaveLength(1);
    const row = screen.getByText("addToCart").closest("div.mt-5, div.fixed");
    expect(row?.className).toContain("fixed");
    expect(row?.className).toContain("md:static");
  });

  it("keeps AWJ Modern's row static (no theme regression)", () => {
    render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
      />,
    );

    const row = screen.getByText("addToCart").closest("div");
    expect(row?.className).not.toContain("fixed");
  });

  it("add-to-cart still sends the same authoritative arguments under Market", async () => {
    const user = userEvent.setup();
    render(
      <PublishedThemeMarkerProvider themePreset="awj-market">
        <ProductDetails
          product={productWithoutCustomVariants}
          basePath="/us/en"
        />
      </PublishedThemeMarkerProvider>,
    );

    await user.click(screen.getByText("addToCart"));

    expect(mockAddItem).toHaveBeenCalledWith("product-1", 1, "base", null);
  });
});

describe("ProductDetails — CUST-H2-5 public page presentation parity", () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockSurface.current = "dtc";
  });

  const productWithDescriptionAndSku = {
    ...productWithoutCustomVariants,
    id: "product-5",
    name: "Described Product",
    description: "A great description of the product.",
    categories: [],
  } as unknown as Product;

  function contentColumnText(container: HTMLElement): string {
    const column = container.querySelector(".lg\\:max-w-2xl");
    if (!column) throw new Error("content column not found");
    return column.textContent ?? "";
  }

  it("renders today's exact default region order when pagePresentation is absent", () => {
    const { container } = render(
      <ProductDetails
        product={productWithDescriptionAndSku}
        basePath="/us/en"
      />,
    );

    const text = contentColumnText(container);
    const order = [
      "Described Product",
      "$25.00",
      "inStock",
      "addToCart",
      "A great description of the product.",
      "MASTER-SKU-001",
    ];
    const positions = order.map((needle) => text.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("hides an optional region marked not visible, without changing anything else", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        regions: [
          { id: "media_gallery", key: "media_gallery", visible: true },
          { id: "identity", key: "identity", visible: true },
          { id: "price", key: "price", visible: true },
          { id: "availability", key: "availability", visible: true },
          { id: "quantity_cta", key: "quantity_cta", visible: true },
          { id: "description", key: "description", visible: false },
          { id: "custom_fields", key: "custom_fields", visible: true },
          {
            id: "sku_options_details",
            key: "sku_options_details",
            visible: true,
          },
        ],
      },
    };

    render(
      <ProductDetails
        product={productWithDescriptionAndSku}
        basePath="/us/en"
        pagePresentation={pagePresentation}
      />,
    );

    expect(
      screen.queryByText("A great description of the product."),
    ).not.toBeInTheDocument();
    // Data-absence stays authoritative for what remains: SKU is real data,
    // still shown.
    expect(screen.getByText("MASTER-SKU-001")).toBeInTheDocument();
  });

  it("respects an authored non-default region order", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        regions: [
          { id: "media_gallery", key: "media_gallery", visible: true },
          { id: "identity", key: "identity", visible: true },
          { id: "price", key: "price", visible: true },
          { id: "availability", key: "availability", visible: true },
          { id: "quantity_cta", key: "quantity_cta", visible: true },
          // Authored order: SKU/details before the description.
          {
            id: "sku_options_details",
            key: "sku_options_details",
            visible: true,
          },
          { id: "description", key: "description", visible: true },
          { id: "custom_fields", key: "custom_fields", visible: true },
        ],
      },
    };

    const { container } = render(
      <ProductDetails
        product={productWithDescriptionAndSku}
        basePath="/us/en"
        pagePresentation={pagePresentation}
      />,
    );

    const text = contentColumnText(container);
    expect(text.indexOf("MASTER-SKU-001")).toBeLessThan(
      text.indexOf("A great description of the product."),
    );
  });

  const variantOptionType = {
    id: "opt-color",
    name: "Color",
    label: "Color",
    position: 0,
    kind: "awj_generic",
  };
  const redValue = {
    id: "val-red",
    option_type_id: "opt-color",
    name: "Red",
    label: "Red",
    position: 0,
    color_code: null,
    option_type_name: "Color",
    option_type_label: "Color",
    image_url: null,
  };
  const productWithRealVariants = {
    id: "product-6",
    name: "Variant Product",
    slug: "variant-product",
    default_variant_id: "variant-red",
    default_variant: {
      id: "variant-red",
      product_id: "product-6",
      sku: "SKU-RED",
      options_text: "Red",
      purchasable: true,
      in_stock: true,
      option_values: [redValue],
      price: {
        display_amount: "$30.00",
        amount_in_cents: 3000,
        compare_at_amount_in_cents: null,
        display_compare_at_amount: null,
      },
      original_price: null,
    },
    variants: [
      {
        id: "variant-red",
        product_id: "product-6",
        sku: "SKU-RED",
        options_text: "Red",
        purchasable: true,
        in_stock: true,
        media: [],
        option_values: [redValue],
        price: {
          display_amount: "$30.00",
          amount_in_cents: 3000,
          compare_at_amount_in_cents: null,
          display_compare_at_amount: null,
        },
        original_price: null,
      },
    ],
    option_types: [variantOptionType],
    media: [],
    purchasable: true,
    in_stock: true,
    price: {
      display_amount: "$30.00",
      amount_in_cents: 3000,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
    original_price: null,
    description: null,
    description_html: null,
    custom_fields: [],
    categories: [],
  } as unknown as Product;

  it("never hides variant_selector for a product with variants, even if the stored entry marks it not visible", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        regions: [
          { id: "variant_selector", key: "variant_selector", visible: false },
        ],
      },
    };

    render(
      <ProductDetails
        product={productWithRealVariants}
        basePath="/us/en"
        pagePresentation={pagePresentation}
      />,
    );

    // VariantPicker (real, unmocked) renders the option type's own label.
    expect(screen.getByText("Color")).toBeInTheDocument();
  });

  it("omits variant_selector for a product without variants, even if a stored entry marks it visible", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        regions: [
          { id: "variant_selector", key: "variant_selector", visible: true },
        ],
      },
    };

    render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
        pagePresentation={pagePresentation}
      />,
    );

    // The simple fixture's own option types are empty, so there is nothing
    // to select from regardless — this proves it stays that way rather than
    // fabricating a picker from a stale stored flag.
    expect(screen.queryByText("Color")).not.toBeInTheDocument();
    expect(screen.queryByText("selectOptions")).not.toBeInTheDocument();
  });

  it("fails safe to the default layout when the stored regions array is missing a commerce-critical region", () => {
    const malformedPagePresentation = {
      product: {
        version: 1,
        // `quantity_cta` (Add-to-Cart) missing outright.
        regions: [
          { id: "media_gallery", key: "media_gallery", visible: true },
          { id: "identity", key: "identity", visible: true },
          { id: "price", key: "price", visible: true },
        ],
      },
    } as any as PagePresentation;

    render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
        pagePresentation={malformedPagePresentation}
      />,
    );

    // Add-to-Cart must never disappear because of a malformed stored document.
    expect(screen.getByText("addToCart")).toBeInTheDocument();
  });
});

describe("ProductDetails — CUST-H3-3 density container-padding parity", () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockSurface.current = "dtc";
  });

  function pageShell(container: HTMLElement): Element {
    const shell = container.querySelector(".max-w-store");
    if (!shell) throw new Error("page shell not found");
    return shell;
  }

  it("defaults to the pre-H3-3 comfortable padding when density is absent", () => {
    const { container } = render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
      />,
    );

    expect(pageShell(container).className).toContain("py-5");
    expect(pageShell(container).className).toContain("md:py-6");
  });

  it("keeps the comfortable padding for an explicit comfortable density", () => {
    const { container } = render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
        density="comfortable"
      />,
    );

    expect(pageShell(container).className).toContain("py-5");
    expect(pageShell(container).className).toContain("md:py-6");
  });

  it("shrinks the page shell's own padding for a compact density", () => {
    const { container } = render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
        density="compact"
      />,
    );

    expect(pageShell(container).className).toContain("py-3");
    expect(pageShell(container).className).not.toContain("py-5");
  });

  it("fails closed to the comfortable padding for an unknown density value", () => {
    const { container } = render(
      <ProductDetails
        product={productWithoutCustomVariants}
        basePath="/us/en"
        density="unknown-value"
      />,
    );

    expect(pageShell(container).className).toContain("py-5");
    expect(pageShell(container).className).toContain("md:py-6");
  });

  it("keeps AWJ Market's own locked compact chrome regardless of density", () => {
    const { container } = render(
      <PublishedThemeMarkerProvider themePreset="awj-market">
        <ProductDetails
          product={productWithoutCustomVariants}
          basePath="/us/en"
          density="comfortable"
        />
      </PublishedThemeMarkerProvider>,
    );

    // AWJ Market's compact chrome (Master Spec §29) is a separate, already
    // locked identity decision — it must not be overridden by this generic
    // density resolver even when density itself says "comfortable".
    expect(pageShell(container).className).toContain("py-3");
    expect(pageShell(container).className).toContain("md:py-5");
    expect(pageShell(container).className).not.toContain("py-5 md:py-6");
  });
});
