# COM-7-P3A — AWJ Storefront First Real Catalog Experience

**Status:** Implementation complete, PR open, not merged, not deployed
**Date:** 2026-09-12
**Repository:** safwan5001-source/Nebrax

## 1. Executive summary

The production storefront still rendered the upstream Spree starter homepage (Spree branding, GitHub fork / quickstart links, `NEXT_PUBLIC_STORE_NAME` / `Spree Store`). Catalog reads were already on the AWJ adapter (COM-7-P1) and hostname resolution was already fail-closed (P2A/P2B), but buyer-visible chrome never consumed the resolved store identity.

This change extends `GET store/v1/storefront` with a public `name`, drives header/footer/hero/metadata from that server-resolved name, removes buyer-visible Spree demo links from homepage chrome, and shows AWJ products/categories or a real empty catalog state.

No Spree backend. No production data, commands, merge, or deploy.

## 2. Exact scope implemented

- `StorefrontConfigController`: add `name` beside existing `default_locale`.
- Storefront adapter: `fetchStorefrontConfig()` / `fetchStorefrontName()`.
- Homepage hero + categories section + featured empty state.
- Header/footer identity (no Spree logo, no GitHub/quickstart/learn-more).
- Homepage metadata title from resolved name.
- Focused isolation tests for the public identity contract.

Out of scope and untouched: cart, checkout, payments, shipping, fulfillment, invoices, ZATCA, customer auth, accounting, inventory valuation, ERP UI, theme builder, custom-domain / SalesChannel / StorefrontDomain architecture, production seeding.

## 3. Root cause of the previous Spree demo homepage

`HeroSection` / `Footer` still contained the starter “Demo-only: Remove for production.” GitHub and Spree quickstart links. `getStoreName()` read `NEXT_PUBLIC_STORE_NAME` and fell back to `"Spree Store"`. `Header` rendered `/spree.png`. `GET store/v1/storefront` only returned `default_locale`.

## 4. Architecture / data flow after change

```
visitor Host
  → Next.js storefront server (next/headers Host)
  → X-Storefront-Forwarded-Host + STOREFRONT_GATEWAY_SECRET
  → ResolveStorefrontDomain (fail-closed)
  → StorefrontContext + TenantContext
  → GET store/v1/storefront → { name, default_locale }
  → GET store/v1/products + categories → AWJ published catalog only
```

Identity is never taken from the browser, a query string, a cookie, or `NEXT_PUBLIC_STORE_NAME`. A failed identity fetch returns `null` and chrome uses the existing `footer.shop` label — not another tenant and not `Spree Store`.

## 5. Files changed

See the PR diff. Canonical points:

- `app/Http/Controllers/Api/StorefrontConfigController.php`
- `tests/Feature/StorefrontPublicIdentityTest.php`
- `storefront/src/lib/commerce/storefront.ts`
- homepage / layout / header / footer / featured products
- focused storefront tests
- this report

## 6. Tenant-isolation / security evidence

- Hostname remains server-authoritative.
- Unknown host on `GET store/v1/storefront` remains 404.
- Two tenants on the forwarded-host gateway: host A returns name A, never name B.
- Public payload does not include `tenant_id`, `sales_channel_id`, or `storefront_id`.
- Catalog still comes only from `store/v1` through the existing adapter.
- No `SPREE_API_URL` / `SPREE_PUBLISHABLE_KEY`.

## 7. Arabic / English behavior

Arabic remains the default storefront language. Homepage chrome uses existing next-intl keys (`home.welcome`, `home.shopNow`, `home.qualityDescription`, `products.noProductsFound`, `header.categories`) so locale parity is preserved without adding keys. English remains a full LTR equivalent via the existing message files.

## 8. Empty catalog behavior

Zero published products (or a fail-closed catalog error) renders `products.noProductsFound` plus `products.browseCollection`. No fake products, prices, ratings, or banners. No production seed.

## 9. Tests and exact results

Focused storefront tests were run locally before the sandbox workspace was recycled:

- `storefront.test.ts`, `HeroSection.test.tsx`, `FeaturedProducts.test.tsx`, `products.test.ts`, `config.test.ts`, `categories.test.ts`: **6 files / 30 passed**
- full `pnpm test`: **42 files / 301 passed**

Laravel `StorefrontPublicIdentityTest` was written but **not executed in this sandbox** (no Composer `vendor/`). CI on the PR must run it on SQLite and PostgreSQL.

## 10. pnpm build result

`pnpm build` was started twice and killed with SIGKILL / exit 137 (sandbox memory). **Not verified locally.** CI storefront build is the authority.

## 11. CI status

Not claimed green in this report. Wait for the PR checks.

## 12. Risks / remaining items

- Checkout layout still uses `/spree.png` + `getStoreName()` (checkout is out of scope).
- `StoreContext` / emails / non-home SEO helpers still read `NEXT_PUBLIC_STORE_NAME`.
- Unused translation strings (`home.heroDescription`, `footer.forkOnGithub`, …) still contain upstream starter copy but are no longer rendered on the homepage chrome implemented here.
- Dominah may have zero published listings; the empty state is correct until catalog data exists.

## 13. Explicit confirmation

- No Spree backend added.
- No production data changed.
- No production Artisan commands executed.
- No Railway variables or networking changed.
- No merge.
- No deploy.

Tool-limitation check: the public identity field was added on the existing `StorefrontConfigController` + `store/v1/storefront` contract. Homepage chrome was changed in the existing Hero/Header/Footer/layout files. Placement was not moved to a workaround layer.

## 14. Branch

`feat/com-7-p3a-real-catalog-homepage`

## 15. PR

Opened against `main`. Number/link in the GitHub PR.

## 16. Base SHA

`83a54bdfb5d6748ddba03ae82dfa1ffc43316dda`

## 17. Head SHA

Recorded on the branch tip after this commit.

## 18. Recommended next step

1. Review the PR.
2. Wait for CI (storefront vitest, Laravel identity tests on SQLite + PostgreSQL, storefront build).
3. After Safwan approves and merges, deploy the storefront so Railway serves the real homepage.
4. Confirm live `storefront-production-2266.up.railway.app` shows Dominah identity and either published products or the empty catalog state.
5. Do not seed production catalog data in this phase.

## Final check answers

1. Buyer-visible Spree demo content on the homepage chrome in this PR: **no** (hero/header/footer). Checkout layout logo is unchanged and out of scope.
2. Displayed store identity comes from **server-resolved `GET store/v1/storefront` → `Storefront.name`** (Tenant.name only on the non-production legacy path).
3. Homepage products come from **AWJ `store/v1/products` via the existing catalog adapter**.
4. Zero published products → empty catalog state, no demo data.
5. Unknown hostname → **no**. Fail-closed 404. No fallback tenant.
6. Spree backend added/required? **No.**
7. Cart/checkout/payment behavior touched? **No.**
8. Production data modified or anything deployed? **No.**
