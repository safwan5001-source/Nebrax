import type { Product } from "@spree/sdk";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "@/components/products/ProductCard";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ currency: "USD", locale: "en", loading: false }),
}));

const mockAddItem = vi.fn();
const mockSurface = { current: "dtc" as "dtc" | "wholesale" };
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ addItem: mockAddItem, surface: mockSurface.current }),
}));

// Minimal product fixtures — cast to Product for component props
const baseProduct = {
  id: "prod-1",
  name: "Classic T-Shirt",
  slug: "classic-t-shirt",
  purchasable: true,
  thumbnail_url: "https://example.com/shirt.jpg",
  price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
    compare_at_amount_in_cents: null,
    display_compare_at_amount: null,
  },
  original_price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
  },
} as unknown as Product;

const saleProduct = {
  id: "prod-2",
  name: "Sale T-Shirt",
  slug: "sale-t-shirt",
  purchasable: true,
  thumbnail_url: "https://example.com/shirt.jpg",
  price: {
    display_amount: "$15.00",
    amount_in_cents: 1500,
    compare_at_amount_in_cents: null,
    display_compare_at_amount: null,
  },
  original_price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
  },
} as unknown as Product;

const outOfStockProduct = {
  id: "prod-3",
  name: "Sold Out Item",
  slug: "sold-out-item",
  purchasable: false,
  thumbnail_url: "https://example.com/shirt.jpg",
  price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
    compare_at_amount_in_cents: null,
    display_compare_at_amount: null,
  },
  original_price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
  },
} as unknown as Product;

const noImageProduct = {
  id: "prod-4",
  name: "No Image Product",
  slug: "no-image",
  purchasable: true,
  thumbnail_url: null,
  price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
    compare_at_amount_in_cents: null,
    display_compare_at_amount: null,
  },
  original_price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
  },
} as unknown as Product;

describe("ProductCard", () => {
  it("renders product name and price", () => {
    render(<ProductCard product={baseProduct} basePath="/us/en" />);

    expect(screen.getByText("Classic T-Shirt")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
  });

  it("links to the product page", () => {
    render(<ProductCard product={baseProduct} basePath="/us/en" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/us/en/products/classic-t-shirt");
  });

  it("shows Sale badge when on sale", () => {
    render(<ProductCard product={saleProduct} basePath="/us/en" />);

    expect(screen.getByText("sale")).toBeInTheDocument();
  });

  it("shows strikethrough price when on sale", () => {
    render(<ProductCard product={saleProduct} basePath="/us/en" />);

    expect(screen.getByText("$15.00")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    const strikethrough = screen.getByText("$25.00");
    expect(strikethrough).toHaveClass("line-through");
  });

  it("does not show Sale badge for regular price products", () => {
    render(<ProductCard product={baseProduct} basePath="/us/en" />);

    expect(screen.queryByText("sale")).not.toBeInTheDocument();
  });

  it("shows Out of Stock for non-purchasable products", () => {
    render(<ProductCard product={outOfStockProduct} basePath="/us/en" />);

    expect(screen.getByText("outOfStock")).toBeInTheDocument();
  });

  it("renders image when thumbnail_url is provided", () => {
    render(<ProductCard product={baseProduct} basePath="/us/en" />);

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/shirt.jpg");
    expect(img).toHaveAttribute("alt", "Classic T-Shirt");
  });

  it("renders placeholder when no thumbnail", () => {
    render(<ProductCard product={noImageProduct} basePath="/us/en" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("uses empty basePath by default", () => {
    render(<ProductCard product={baseProduct} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/products/classic-t-shirt");
  });
});

describe("ProductCard — purchase action (STORE-UI-3)", () => {
  const simple = {
    id: "prod-simple",
    name: "Simple Product",
    slug: "simple-product",
    purchasable: true,
    thumbnail_url: null,
    price: {
      display_amount: "$25.00",
      amount_in_cents: 2500,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
    original_price: null,
  } as unknown as Product;

  const variantManaged = {
    ...simple,
    id: "prod-variant",
    name: "Variant Managed",
    slug: "variant-managed",
    isVariantManaged: true,
    price: {
      display_amount: null,
      amount_in_cents: null,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
  } as unknown as Product;

  const unavailable = {
    ...simple,
    id: "prod-gone",
    name: "Unavailable",
    slug: "unavailable",
    purchasable: false,
  } as unknown as Product;

  beforeEach(() => {
    mockAddItem.mockReset();
    mockAddItem.mockResolvedValue(undefined);
    mockSurface.current = "dtc";
  });

  it("adds a simple product by its product id, with no variant and no price", async () => {
    const user = userEvent.setup();
    render(<ProductCard product={simple} basePath="/sa/en" />);

    await user.click(screen.getByRole("button", { name: "addToCart" }));

    expect(mockAddItem).toHaveBeenCalledWith("prod-simple", 1, "base", null);
  });

  it("never adds a variant-managed product — it routes to the detail page", () => {
    render(<ProductCard product={variantManaged} basePath="/sa/en" />);

    expect(screen.queryByRole("button", { name: "addToCart" })).toBeNull();
    const link = screen.getByRole("link", { name: "selectOptions" });
    expect(link).toHaveAttribute("href", "/sa/en/products/variant-managed");
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("offers no working add action for an unavailable product", () => {
    render(<ProductCard product={unavailable} basePath="/sa/en" />);

    expect(screen.queryByRole("button", { name: "addToCart" })).toBeNull();
    expect(screen.queryByRole("link", { name: "selectOptions" })).toBeNull();
    // Stated once, on the action line — not twice.
    expect(screen.getAllByText("outOfStock")).toHaveLength(1);
  });

  it("prevents a duplicate submit while the first is still in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    mockAddItem.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    render(<ProductCard product={simple} basePath="/sa/en" />);
    const button = screen.getByRole("button", { name: "addToCart" });

    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);

    expect(mockAddItem).toHaveBeenCalledTimes(1);
    release?.();
  });

  it("re-enables the action after the server rejects, without claiming success", async () => {
    const user = userEvent.setup();
    mockAddItem.mockRejectedValue(new Error("rejected"));

    render(<ProductCard product={simple} basePath="/sa/en" />);
    await user
      .click(screen.getByRole("button", { name: "addToCart" }))
      .catch(() => undefined);

    // The button returns to its normal label; nothing announces a success the
    // server refused. Error reporting stays with the cart's own path.
    expect(
      await screen.findByRole("button", { name: "addToCart" }),
    ).toBeEnabled();
  });

  it("leaves the wholesale surface link-only", () => {
    mockSurface.current = "wholesale";
    render(<ProductCard product={simple} basePath="/sa/en" />);

    expect(screen.queryByRole("button", { name: "addToCart" })).toBeNull();
  });
});

describe("ProductCard — favourites affordance (DESIGN_ONLY)", () => {
  const simple = {
    id: "prod-simple",
    name: "Simple Product",
    slug: "simple-product",
    purchasable: true,
    thumbnail_url: null,
    price: {
      display_amount: "$25.00",
      amount_in_cents: 2500,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
    original_price: null,
  } as unknown as Product;

  it("renders no heart outside a WishlistProvider, rather than a dead control", () => {
    render(<ProductCard product={simple} basePath="/sa/en" />);

    expect(screen.queryByRole("button", { name: "addToFavorites" })).toBeNull();
  });
});
