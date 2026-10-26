# META-BRAND-1 — Storefront metadata branding audit & fix

- **Base SHA:** `2f4de9c01ba5f1a7e5280c741aa7c4628114da2b` (origin/main)
- **Head SHA:** see PR head (last commit on `claude/storefront-metadata-branding-i6cu95`)
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
