import { describe, expect, it } from "vitest";
import {
  mapAwjCategoryToViewModel,
  mapAwjProductToViewModel,
} from "../mappers";
import type { AwjCategory, AwjProduct } from "../types";

function baseProduct(overrides: Partial<AwjProduct> = {}): AwjProduct {
  return {
    id: "prod-1",
    name: "منتج تجريبي",
    name_en: "Demo Product",
    description: "وصف",
    sku: "SKU-1",
    category: { id: "cat-1", name: "إلكترونيات" },
    price: { amount_minor: 12345, currency: "SAR" },
    in_stock: true,
    thumbnail_url: "https://example.test/media/1",
    media: [
      {
        id: "media-1",
        url: "https://example.test/media/1",
        alt: null,
        position: 0,
      },
      {
        id: "media-2",
        url: "https://example.test/media/2",
        alt: "alt text",
        position: 1,
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("mapAwjProductToViewModel", () => {
  it("maps price, availability, and category into the Spree-shaped view model", () => {
    const viewModel = mapAwjProductToViewModel(baseProduct());

    expect(viewModel.id).toBe("prod-1");
    expect(viewModel.name).toBe("منتج تجريبي");
    expect(viewModel.slug).toBe("prod-1"); // AWJ has no product slug yet — id doubles as the routing token.
    expect(viewModel.price.amount_in_cents).toBe(12345);
    expect(viewModel.price.currency).toBe("SAR");
    expect(viewModel.purchasable).toBe(true);
    expect(viewModel.in_stock).toBe(true);
    expect(viewModel.categories).toEqual([
      expect.objectContaining({ id: "cat-1", name: "إلكترونيات" }),
    ]);
  });

  it("uses name_en when locale is English (COM-7-P2B)", () => {
    const viewModel = mapAwjProductToViewModel(baseProduct(), "en");
    expect(viewModel.name).toBe("Demo Product");
  });

  it("uses the Arabic name when locale is Arabic", () => {
    const viewModel = mapAwjProductToViewModel(baseProduct(), "ar");
    expect(viewModel.name).toBe("منتج تجريبي");
  });

  it("uses the Arabic name when no locale is passed at all", () => {
    const viewModel = mapAwjProductToViewModel(baseProduct());
    expect(viewModel.name).toBe("منتج تجريبي");
  });

  it("falls back to the Arabic name in English when name_en is null", () => {
    const viewModel = mapAwjProductToViewModel(
      baseProduct({ name_en: null }),
      "en",
    );
    expect(viewModel.name).toBe("منتج تجريبي");
  });

  it("carries the SKU onto a synthetic default variant (AWJ has no variant model)", () => {
    const viewModel = mapAwjProductToViewModel(baseProduct({ sku: "SKU-XYZ" }));

    expect(viewModel.variants).toEqual([]);
    expect(viewModel.default_variant?.sku).toBe("SKU-XYZ");
    expect(viewModel.default_variant?.price.amount_in_cents).toBe(12345);
  });

  it("maps every media item and sets the first as primary", () => {
    const viewModel = mapAwjProductToViewModel(baseProduct());

    expect(viewModel.media).toHaveLength(2);
    expect(viewModel.media?.[1].alt).toBe("alt text");
    expect(viewModel.primary_media?.id).toBe("media-1");
  });

  it("treats in_stock: null as unknown availability, not out-of-stock", () => {
    const viewModel = mapAwjProductToViewModel(baseProduct({ in_stock: null }));

    // Unknown availability must not be conflated with "purchasable: false" —
    // the storefront API returns null specifically to mean "we don't know",
    // per StorefrontProductController's FulfillmentPolicyNotConfiguredException handling.
    expect(viewModel.purchasable).toBe(true);
    expect(viewModel.in_stock).toBe(true);
  });

  it("marks a product with in_stock: false as not purchasable", () => {
    const viewModel = mapAwjProductToViewModel(
      baseProduct({ in_stock: false }),
    );

    expect(viewModel.purchasable).toBe(false);
    expect(viewModel.available).toBe(false);
    expect(viewModel.in_stock).toBe(false);
  });

  it("handles a product with no media and no category gracefully", () => {
    const viewModel = mapAwjProductToViewModel(
      baseProduct({ media: [], category: null, thumbnail_url: null }),
    );

    expect(viewModel.media).toEqual([]);
    expect(viewModel.primary_media).toBeUndefined();
    expect(viewModel.categories).toEqual([]);
    expect(viewModel.thumbnail_url).toBeNull();
  });
});

describe("mapAwjCategoryToViewModel", () => {
  function baseCategory(overrides: Partial<AwjCategory> = {}): AwjCategory {
    return {
      id: "cat-1",
      name: "إلكترونيات",
      description: "قسم الإلكترونيات",
      color: "#3366ff",
      parent_id: null,
      ...overrides,
    };
  }

  it("maps a root category with no children", () => {
    const viewModel = mapAwjCategoryToViewModel(baseCategory());

    expect(viewModel.id).toBe("cat-1");
    expect(viewModel.permalink).toBe("cat-1");
    expect(viewModel.is_root).toBe(true);
    expect(viewModel.is_leaf).toBe(true);
    expect(viewModel.children).toBeUndefined();
  });

  it("recursively maps nested children", () => {
    const viewModel = mapAwjCategoryToViewModel(
      baseCategory({
        children: [
          baseCategory({ id: "cat-2", name: "هواتف", parent_id: "cat-1" }),
        ],
      }),
    );

    expect(viewModel.children).toHaveLength(1);
    expect(viewModel.children?.[0].id).toBe("cat-2");
    expect(viewModel.children?.[0].depth).toBe(1);
    expect(viewModel.is_leaf).toBe(false);
  });

  it("maps ancestors for a non-root category", () => {
    const viewModel = mapAwjCategoryToViewModel(
      baseCategory({
        id: "cat-3",
        parent_id: "cat-1",
        ancestors: [{ id: "cat-1", name: "إلكترونيات" }],
      }),
    );

    expect(viewModel.is_root).toBe(false);
    expect(viewModel.is_child).toBe(true);
    expect(viewModel.ancestors).toEqual([
      expect.objectContaining({ id: "cat-1", name: "إلكترونيات" }),
    ]);
  });
});

describe("mapAwjProductToViewModel — options and variants (STORE-UI-3)", () => {
  function variantProduct(overrides: Partial<AwjProduct> = {}): AwjProduct {
    return baseProduct({
      is_variant_managed: true,
      price: { amount_minor: 0, currency: "SAR" },
      options: [
        {
          id: "opt-size",
          name: "المقاس",
          name_en: "Size",
          values: [
            { id: "val-s", value: "صغير", value_en: "Small" },
            { id: "val-l", value: "كبير", value_en: "Large" },
          ],
        },
        {
          id: "opt-cap",
          name: "السعة",
          name_en: "Capacity",
          values: [{ id: "val-1l", value: "1 لتر", value_en: "1 L" }],
        },
      ],
      variants: [
        {
          id: "var-1",
          sku: "SKU-S-1L",
          descriptor: "صغير / 1 لتر",
          option_value_ids: ["val-s", "val-1l"],
          price: { amount_minor: 5000, currency: "SAR" },
          in_stock: true,
          media: [],
        },
        {
          id: "var-2",
          sku: "SKU-L-1L",
          descriptor: "كبير / 1 لتر",
          option_value_ids: ["val-l", "val-1l"],
          price: { amount_minor: 7500, currency: "SAR" },
          in_stock: false,
          media: [
            {
              id: "media-v2",
              url: "https://example.test/media/v2",
              alt: null,
              position: 0,
            },
          ],
        },
      ],
      ...overrides,
    });
  }

  it("maps every merchant-defined option group, whatever it is called", () => {
    const vm = mapAwjProductToViewModel(variantProduct());

    expect(vm.option_types?.map((o) => o.name)).toEqual(["المقاس", "السعة"]);
    expect(vm.option_values?.map((v) => v.id)).toEqual([
      "val-s",
      "val-l",
      "val-1l",
    ]);
  });

  it("never claims an option is a colour swatch and never invents a colour", () => {
    const vm = mapAwjProductToViewModel(
      variantProduct({
        options: [
          {
            id: "opt-color",
            // Named "colour" on purpose: AWJ still supplies no colour value,
            // so presentation must not be inferred from the label.
            name: "اللون",
            name_en: "Color",
            values: [{ id: "val-red", value: "أحمر", value_en: "Red" }],
          },
        ],
        variants: [],
      }),
    );

    expect(vm.option_types?.every((o) => o.kind === "awj_generic")).toBe(true);
    expect(vm.option_types?.some((o) => o.kind === "color_swatch")).toBe(false);
    expect(vm.option_values?.every((v) => v.color_code === null)).toBe(true);
  });

  it("resolves each variant to its own option values, price, stock and media", () => {
    const vm = mapAwjProductToViewModel(variantProduct());
    const [first, second] = vm.variants ?? [];

    expect(first.id).toBe("var-1");
    expect(first.option_values.map((v) => v.id)).toEqual(["val-s", "val-1l"]);
    expect(first.price.amount_in_cents).toBe(5000);
    expect(first.purchasable).toBe(true);

    expect(second.price.amount_in_cents).toBe(7500);
    expect(second.purchasable).toBe(false);
    expect(second.media?.[0]?.id).toBe("media-v2");
  });

  it("gives a variant-managed listing row no price rather than a free one", () => {
    // The listing endpoint sends amount_minor 0 with no variants attached.
    const vm = mapAwjProductToViewModel(
      variantProduct({ options: undefined, variants: undefined }),
    );

    expect(vm.isVariantManaged).toBe(true);
    expect(vm.price.display_amount).toBeNull();
    expect(vm.price.amount_in_cents).toBeNull();
  });

  it("keeps a real zero price for a simple product that genuinely costs nothing", () => {
    const vm = mapAwjProductToViewModel(
      baseProduct({ price: { amount_minor: 0, currency: "SAR" } }),
    );

    expect(vm.isVariantManaged).toBe(false);
    expect(vm.price.amount_in_cents).toBe(0);
    expect(vm.price.display_amount).not.toBeNull();
  });

  it("withholds the synthetic default variant from a variant-managed product", () => {
    // That id is `${product.id}-default` and would add the parent to the cart.
    expect(
      mapAwjProductToViewModel(variantProduct()).default_variant,
    ).toBeUndefined();
    expect(
      mapAwjProductToViewModel(baseProduct()).default_variant,
    ).toBeDefined();
  });

  it("does not present a plain-text description as authored HTML", () => {
    const vm = mapAwjProductToViewModel(
      baseProduct({ description: "سطر\nسطر آخر" }),
    );

    expect(vm.description).toBe("سطر\nسطر آخر");
    expect(vm.description_html).toBeNull();
  });

  it("leaves a simple product with no options or variants", () => {
    const vm = mapAwjProductToViewModel(baseProduct());

    expect(vm.option_types).toEqual([]);
    expect(vm.variants).toEqual([]);
    expect(vm.variant_count).toBe(0);
  });
});
