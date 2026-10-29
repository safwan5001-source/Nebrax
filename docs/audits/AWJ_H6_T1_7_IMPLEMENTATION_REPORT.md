# H6 / T1-7 — Catalog Request Parameter Types

Storefront only, type-only, zero intended runtime change. No orders/cart/checkout/payments/accounting, migrations, backend/API, feature-gate or UI changes. No request-construction, serialisation, validation, filtering, caching, tenant or locale code touched.

## New parameter types (`storefront/src/lib/commerce/types.ts`)
- `StoreListParams` — `page?`, `limit?`, `sort?`, `expand?: string[]`, `fields?: string[]`.
- `StoreProductListParams extends StoreListParams` — `search?`, `name_cont?`, `price_gte?`, `price_lte?`, `with_option_value_ids?`, `in_stock?`, `out_of_stock?`, `in_category?`, `in_categories?`, plus the flat predicate index signature `[key: string]: string | number | boolean | (string | number)[] | undefined` (the AWJ listing context forwards `collection`, `brand_id`, `deliver_today`, `facet[<key>]` through it).
- `StoreCategoryListParams extends StoreListParams` — `name_cont?`, `parent_id_eq?`, `depth_eq?`, same index signature.
Field-for-field the shape of the SDK parameter types the code already used; no new parameters, no changed defaults.

## Migrated consumers
`lib/utils/product-query.ts` (builder return type + local), `lib/utils/listing-context.ts` (`ListingContextParams`, `StorefrontListParams` aliases + doc comment), `lib/data/categories.ts` (`CategoryListParams`, `ProductListParams`), `lib/data/wholesale.ts` (`ProductListParams`; `Channel` stays an SDK type). Wholesale passes `StoreProductListParams` straight into the SDK client call, which accepts it structurally — no cast, no runtime change.

## Spree dependency counts
`spree_type_imports` **91 → 86 (−5)**: categories.ts 2→0, wholesale.ts 2→1, listing-context.ts 1→0, product-query.ts 1→0. Others unchanged: value 4, client 68, wrapper 77, env 9. Baseline diff decreases only. (The commit message of `a6a0b7a66` says "→ 87"; the verified figure is 86.)

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest (listing params, search, sort, filters, pagination, wholesale, product-query included) | 240 files passed / 16 skipped; 3462 tests passed |
| Biome (changed files) | clean; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | exit 0 |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |
Request payloads / generated URLs: only `import type` lines, annotations and one doc-comment name changed; the existing product-query / listing-context / pagination tests (which assert the produced params and URLs) pass untouched.

## Remaining Spree dependencies
Catalog: `data/wholesale.ts` (`Channel`), `gtm.ts` (`Cart`, `LineItem`, `Order`), `app/dev/*` and tests (not counted). Rest of the 86 is cart/checkout/account/addresses/orders/payment/markets/webhooks/auth, plus value 4, client 68, wrapper 77, env 9.

## Risks / compatibility
Low. The index signature intentionally mirrors the SDK's so existing callers that add ad-hoc predicates keep compiling; if the SDK adds a typed field later, `StoreProductListParams` will not pick it up (desired). `ListingContextParams`/`StorefrontListParams` remain aliases of one type.

## Recommended next step
The catalog type surface is now SDK-free except `Channel` (wholesale) and analytics `Cart/LineItem/Order`. Remaining slices are commerce-flow types (cart → checkout → orders/account → addresses/payment/markets), each touching live flows and warranting its own gate and parity tests; start with the read-only account/order display types (`OrderList`, `OrderDetail`, `components/order/*`).

Branch `claude/commerce-h6-t1-7-list-params` · Base `c57474114` · Head: see PR. No merge, no deploy.
