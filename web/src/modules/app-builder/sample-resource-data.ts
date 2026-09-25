/**
 * LIVE-PREVIEW-3 (`AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`) — owner-approved scope
 * (Decision Gate resolved 2026-09-25, option 3): Builder Preview proves `binding`/`collect`/
 * `itemProps`/`$item.*` resolution semantics using **clearly labeled representative/sample
 * data**, never a live fetch against a tenant's real catalog or cart.
 *
 * **Why not real data**: `commerce.products`/`commerce.cart` resolve to the public
 * `commerce/v1` storefront surface (`app/Services/AppBuilder/DataResourceRegistry.php`),
 * authenticated by a per-channel store-bearer token — not the merchant's own Sanctum session the
 * Builder UI runs under. Fetching real data here would need either minting/forwarding a
 * store-bearer token from the Builder session, or a new Sanctum-authenticated proxy endpoint —
 * both out of this task's approved scope (recorded in the horizon doc's durable state). Real live
 * product/cart data in Preview is an intentionally deferred, separately-scoped follow-up.
 *
 * **Field shape discipline**: every field below exists in `DataResourceRegistry`'s real contract
 * for the matching resource — nothing invented, nothing renamed. This is what lets a schema's
 * `$item.<field>`/`itemProps` mappings resolve identically here and on the real runtime for any
 * field both resources actually expose, which is the entire point of proving semantic parity
 * with sample data rather than a schema-agnostic mock shape.
 */

/** `commerce.products` sample list — shape matches `DataResourceRegistry`'s list-item fields exactly (`media`/`options`/`variants` are detail-only on the real resource, so omitted here too). */
export const SAMPLE_COMMERCE_PRODUCTS = [
  {
    id: 'sample-product-1',
    name: 'قهوة عربية مختصة',
    description: 'حبوب بن محمصة طازجة، تحميص متوسط.',
    sku: 'CF-001',
    category: { id: 'sample-category-1', name: 'المشروبات' },
    price: { amount_minor: 4500, currency: 'SAR' },
    in_stock: true,
    thumbnail_url: null,
    is_variant_managed: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'sample-product-2',
    name: 'شاي أخضر فاخر',
    description: 'أوراق شاي أخضر مختارة يدوياً.',
    sku: 'TE-014',
    category: { id: 'sample-category-1', name: 'المشروبات' },
    price: { amount_minor: 3200, currency: 'SAR' },
    in_stock: true,
    thumbnail_url: null,
    is_variant_managed: false,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
  {
    id: 'sample-product-3',
    name: 'كوب سيراميك',
    description: null,
    sku: 'MG-233',
    category: { id: 'sample-category-2', name: 'الأدوات' },
    price: { amount_minor: 6000, currency: 'SAR' },
    in_stock: false,
    thumbnail_url: null,
    is_variant_managed: false,
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
  },
];

/** `commerce.cart` sample — shape matches `DataResourceRegistry`'s single-resource fields exactly. */
export const SAMPLE_COMMERCE_CART = {
  status: 'active',
  items: [
    {
      id: 'sample-cart-item-1',
      product_id: 'sample-product-1',
      product_variant_id: null,
      variant_descriptor: null,
      product_name: 'قهوة عربية مختصة',
      unit_key: 'unit',
      unit_name: 'قطعة',
      quantity: 2,
      unit_price: { amount_minor: 4500, currency: 'SAR' },
      line_total: { amount_minor: 9000, currency: 'SAR' },
      available: true,
    },
    {
      id: 'sample-cart-item-2',
      product_id: 'sample-product-2',
      product_variant_id: null,
      variant_descriptor: null,
      product_name: 'شاي أخضر فاخر',
      unit_key: 'unit',
      unit_name: 'قطعة',
      quantity: 1,
      unit_price: { amount_minor: 3200, currency: 'SAR' },
      line_total: { amount_minor: 3200, currency: 'SAR' },
      available: true,
    },
  ],
  subtotal: { amount_minor: 12200, currency: 'SAR' },
  currency: 'SAR',
};

/** Keyed by `binding.resource` id, exactly as `resolveNodeBindings`'s `resourceData` parameter expects (`web/src/modules/app-builder/runtime-contract.ts`). */
export const SAMPLE_RESOURCE_DATA: Record<string, unknown> = {
  'commerce.products': SAMPLE_COMMERCE_PRODUCTS,
  'commerce.cart': SAMPLE_COMMERCE_CART,
};
