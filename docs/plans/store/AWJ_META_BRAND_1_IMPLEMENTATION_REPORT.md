# META-BRAND-1 — Storefront metadata branding audit & fix

- **Base SHA:** `1bc15a7` (origin/main at finalization; original base `2f4de9c01ba5f1a7e5280c741aa7c4628114da2b`)
- **Head SHA:** see final PR head (report-only commit above the verified code; code identical to the verified tree)
- **Status:** In PR — no merge, no deploy. **H1 (Buyer Identity & Sessions) is not touched and remains Open.**

## Root cause
`generateStoreMetadata` (`storefront/src/lib/metadata/store.ts`, called by the shared `[country]/[locale]/layout.tsx`) built the title template (`%s | <name>`), the default title and `openGraph.siteName` from `getStoreSeoTitle()`/`getStoreName()` → `NEXT_PUBLIC_STORE_NAME || "Spree Store"`. That is a deployment-wide value from the Spree fork, so every page without its own absolute title (products, categories, policies, cart, checkout, account, wholesale…) showed "Spree Store", and one deployment would show the same name for every tenant. The default description also said "powered by Spree Commerce". Secondary leaks: Organization JSON-LD, policy description, hardcoded English titles ("Products", "Categories", "Product Not Found"…).

## Audit (public storefront routes)
| Route | Before | After |
|---|---|---|
| Home | absolute published name (already correct when API answers) | unchanged |
| Products / Categories lists | English literal title; template suffix "Spree Store" | localized (`products.allProducts`/`categories`, ar/en) + published name |
| Product / Category detail | name + "Spree Store"; "…Not Found" English | name + published name; not-found uses localized `notFound.title` |
| Policies | title + "Spree Store"; description used env name | title + published name; description uses published name (omitted if unknown) |
| Search | inherits layout | published name |
| Checkout (`store-checkout`) | no title → bare "Spree Store" | `awjCheckout.title` + published name |
| Cart / Account | client pages, inherit layout default | default = published name (no title export possible; see Risks) |
| Not-found / error | inherit layout | published name |
| OG `siteName`, Organization JSON-LD | env name | published name (JSON-LD omitted if none) |
| Twitter / web-app | no manifest exists; twitter has no name field | unchanged |

## Fix
- New `src/lib/metadata/store-identity.ts`: `resolvePublishedStoreName()` = same rule as the storefront shell (`publishedStoreName`: presentation display name → live store name) from `fetchStorefrontConfig()`; `resolveStoreTitleName(locale)` adds the localized neutral fallback `footer.shop` ("المتجر"/"Shop"). No merchant name is hardcoded.
- `fetchStorefrontConfig` is React-`cache()`d per request and `no-store` across requests (already used by the layout/home/icon route): **no new API calls, no cross-request or cross-tenant cache**.
- `lib/store.ts`: removed "Spree Store" default and the Spree description default; `getStoreName()` is now documented as a no-request-context fallback (emails/legacy shell) with neutral default "Store"; removed unused `getStoreSeoTitle/MetaDescription/Description`. `STORE_META_DESCRIPTION`, keywords and twitter handle remain optional explicit env settings; no default description is emitted.
- Canonical URLs, hreflang, robots/indexing, checkout and account gating: untouched.

## Changed files
`storefront/src/lib/metadata/{store,store-identity,products,categories,product,category}.ts`, `src/lib/store.ts`, `src/lib/seo.ts`, `src/lib/commerce/storefront.ts` (comment), `[locale]/layout.tsx`, `policies/[slug]/page.tsx`, `(store-checkout)/checkout/page.tsx`, tests, `app/Http/Controllers/Api/StorefrontConfigController.php` (comment only), tracker row.

## Tests
- `metadata/__tests__/store.test.ts`: Store A never shows Store B (sequential), published display name beats live name, AR/EN fallback labels, no "spree" anywhere in metadata, no default description, metadataBase/twitter preserved, env `NEXT_PUBLIC_STORE_NAME="Spree Store"` is ignored.
- `metadata/__tests__/page-titles.test.ts`: ar/en listing titles come from the message catalog; static guard against a `"Spree Store"` literal or "powered by Spree" in non-test sources and against env name in `metadata/store.ts`.
- Policy page test updated to the published-name source.
- Local: `pnpm check` (0 errors; 5 warnings/3 infos pre-existing), `check:locales` ✔, `check:spree-ratchet` ✔ (counts unchanged), `tsc --noEmit` ✔, `pnpm test` 236 files / 3406 tests passed.

## CI
See PR checks (storefront-ci: biome, locales, ratchet, tsc, vitest).

## Risks / limits
- No resolvable identity (API down) → neutral localized label ("المتجر"/"Shop") instead of a name; acceptable, never another tenant's.
- Cart and account pages are `"use client"`, so they cannot export titles; they show the store name only. Adding page titles needs server layouts on gated routes — deliberately not done here.
- Legacy `(checkout)` Spree shell, `StoreContext.storeName`, email templates and webhooks still use `getStoreName()` (now "Store" by default, not "Spree Store"); they are Spree-legacy surfaces owned by X5/H6.
- Product/category fallback descriptions now use just the name instead of English templates.
- Deployments that relied on `NEXT_PUBLIC_STORE_NAME`/`STORE_SEO_TITLE` for titles will now get the published identity (intended).

## Next steps
Review/merge decision by owner; then server-side titles for cart/account when H1 routes land; retire `getStoreName()` consumers with X5/H6.

## Finalization (PR #1767)
- Merged latest `origin/main` (`1bc15a7`) into the branch: **no conflicts**. Main brought backend/docs only (commerce staff orders O1a, orders audit); no storefront files changed upstream. The tracker diff vs main is exactly one added `META-BRAND-1` row — no newer Horizon entry was touched, H1 still Open.
- `StorefrontConfigController.php`: diff vs main is a docblock-comment change only; response shape (`name`, `default_locale`, `business_vertical`, `business_identity`, `presentation`, `policy_availability`, `presentation_media`) and data exposure are unchanged — backward compatible, no new private data.
- Tenant isolation: page metadata reads only `fetchStorefrontConfig()` (per-request `cache()`, `no-store`, resolved by request host); no module-level cache, no env name. Verified by sequential Store A/B tests.
- AR/EN: tests cover title/template/`og:siteName`/`og:locale` for `ar` and `en`, fallback labels, and ar/en listing titles from the message catalog.
- Final verification on merged tree: `pnpm check` (0 errors; 5 warnings/3 infos pre-existing), `check:locales` ✔, `check:spree-ratchet` ✔ (value 4, type 147, client 68, wrapper 76, env 9 — unchanged), `tsc --noEmit` ✔, `pnpm test` 236 files / 3406 tests ✔ (16 skipped pre-existing), `pnpm build` ✔, `php -l` ✔.
- Remaining risks: unchanged from above (cart/account have no page title; legacy getStoreName() consumers; neutral fallback when identity API is down).

## Final merge-readiness (second sync with main)
- PR was one commit behind: merged `origin/main` = `7cc31d3` (X5 — close legacy Spree checkout routes + X4 verification, #1765).
- **Only conflict:** the Horizon tracker (X4/X4-FIX region). Resolved by taking main's block verbatim (X4 Deployed row, X4-FIX, X4-LINKS, UI-DEF1) and re-inserting the single `META-BRAND-1` row after `X4-LINKS`. Tracker diff vs main is exactly that one row. All X5 source/tracker changes preserved; no checkout logic touched.
- Spree ratchet: `wrapper_imports=77` is main's new X5 baseline (ratchet script/baseline byte-identical to main; main alone reports the same). META-BRAND-1 adds no Spree imports.
- Re-verification on merged tree: `pnpm check` 0 errors, `check:locales` ✔, ratchet ✔, `tsc --noEmit` ✔, `pnpm test` 238 files / 3416 tests ✔.
