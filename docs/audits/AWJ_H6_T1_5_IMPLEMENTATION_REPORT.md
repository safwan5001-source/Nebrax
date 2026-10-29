# H6 / T1-5 — Product Detail Presentation Types

Storefront only, type-only, zero intended runtime change. No orders/cart/checkout/payments/accounting, migrations, backend/API, feature-gate or mapper-logic changes.

## Types introduced (`storefront/src/lib/commerce/types.ts`)
- `StoreOptionType` — id, name, label, position, kind.
- `StoreOptionValue` — id, option_type_id, name, label, position, color_code, option_type_name/label, image_url.
- `StoreCustomField` — discriminated on `field_type`: `rich_text` ⇒ `value: string | null` (the only kind rendered as HTML), every other kind (including unknown future kinds via `string & {}`) ⇒ `value: unknown`. Replaces the SDK's `value: any`; no `any`, no assertions, and the `default:` branch of the renderer stays reachable as before.
- `StoreVariant extends StoreVariantSummary` — `purchasable`, `in_stock`, `option_values: StoreOptionValue[]`, `media?: StoreMedia[]`.
- `StoreProductDetail extends StoreProductSummary` — `description`, `in_stock`, `media?: StoreMedia[]`, `variants?`, `default_variant?`, `option_types?`, `custom_fields?`.
Reuses `StoreMedia`, `StoreCategoryNode`, `StorePrice`, `StoreVariantSummary`, `StoreProductSummary`. All are structural subsets of the Spree-shaped mapper output (assignable without casts).

## Migrated components
`ProductDetails` (`Product`/`Variant`), `VariantPicker` (`Variant`/`OptionType`), `ProductCustomFields` (`CustomField`), `seo.ts` (`Product`, JSON-LD builder). Pre-existing `as { isVariantManaged?… }` / `as { gifting?… }` reads in `ProductDetails` are unchanged. Biome re-indented one `useState` initializer (whitespace only).

## StoreProduct decoupling — deliberately NOT done
I tried `StoreProduct = StoreProductDetail & {…}` and reverted: `tsc` reported 16 errors. `StoreProduct` is the **full** Spree-shaped mapper output and is consumed as the SDK `Product` by `lib/commerce/products.ts` (data-layer/wholesale unions: `Product[]` returns), by `mappers.ts` (object literal carries `meta_title`, `variant_count`, `primary_media`, `available`, `option_values`, `description_html`…) and by `mappers.test.ts`. Doing it safely needs the data layer's return types and the mapper literal re-typed together. **Documented, not forced.** Proposed follow-up (small): define `StoreProductFull` with the remaining Spree-shaped fields, switch `mappers.ts`/`products.ts`/tests to it, then drop `import("@spree/sdk").Product` from `types.ts`.

## Spree dependency counts
`spree_type_imports` **109 → 103 (−6)**: ProductDetails 2→0, VariantPicker 2→0, ProductCustomFields 1→0, seo.ts 1→0. Others unchanged: value 4, client 68, wrapper 77, env 9. Baseline diff is decreases only.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest (PDP, variant, pricing, media, gifting, SEO/JSON-LD included) | 240 files passed / 16 skipped; 3462 tests passed |
| Biome (changed files) | clean; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | exit 0 |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |

## Remaining SDK dependencies (product-related)
`StoreProduct` (`types.ts`), `mappers.ts` (5: `Media`, `OptionType`, `OptionValue`, `Price`, `Variant`), `lib/commerce/products.ts` (4), `ProductListing`/`InfiniteProductList` (`Product` page generic), `gtm.ts` (`Cart`, `LineItem`, `Order`), `ProductListParams` (`utils/product-query`, `listing-context`, `data/categories`, `data/wholesale`). Non-product: checkout/cart/account/addresses/orders/payment/markets/webhooks.

## Risks / compatibility
Low (type-only). The `StoreCustomField` discriminated union relies on TS assignability from `field_type` unions; verified by `tsc` against the SDK-shaped mapper output and tests. Wholesale PDP passes SDK `Product` — structurally assignable (compiles).

## Next recommended cluster
(1) `StoreProduct` decoupling as described above (mappers + data layer + tests, one PR). (2) then the `ProductListing`/`InfiniteProductList` `Product` generic and `ProductListParams` request types.

Branch `claude/commerce-h6-t1-5-product-detail` · Base `5331e8dff` · Head: see PR. No merge, no deploy.
