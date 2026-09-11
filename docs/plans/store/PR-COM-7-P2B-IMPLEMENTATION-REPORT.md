# PR-COM-7-P2B — Arabic/English + Store/Tenant Integration — Implementation Report

## Identifiers

| Field | Value |
|-------|-------|
| PR | (to be opened) |
| Branch | `claude/com-7-p2b-arabic-english` |
| Base SHA | `70a75361ca9d406c6c77207a8692daec17b42eec` (main, includes merged PR #769/#770) |
| Head SHA | (set after final commit) |
| Predecessor | PR #769 (COM-7-P2A), merged as `c60722cd` |

## Executive Summary

COM-7-P2B replaces the COM-7-P1 provisional `AWJ_STORE_TENANT_SLUG` frontend mechanism with the COM-7-P2A trusted hostname-resolution chain, registers Arabic as the storefront's primary language (with English fully supported), fixes the storefront's RTL/LTR direction handling (~30 physical-direction Tailwind classes, directional icon mirroring, and drawer slide-side), and wires bilingual product name display using AWJ's existing `products.name_en` column. A documented, unresolved schema gap remains for bilingual **category** names (no equivalent column exists — not invented here, per the task's explicit stop condition).

A new secret-gated `X-Storefront-Forwarded-Host` gateway was added to `ResolveStorefrontDomain` because, in this deployment topology, the Next.js storefront server — not the browser — is the sole caller of `store/v1`; without it, Laravel's own `$request->getHost()` would only ever see the Next.js server's own outbound connection target, never the visitor's real hostname. This is documented in detail under "Store/Tenant Resolution Behavior" below, since it was not fully settled by P2A itself (P2A's decision doc explicitly deferred "the final P2 transport contract" to this phase).

Verified end-to-end against a live Laravel backend and a real production (`next build` + standalone server) build: Arabic and English product listing/detail/category pages all render correctly (`lang`/`dir` correct, bilingual product names correct) through the trusted host-based resolution chain, with zero client-controlled tenant authority anywhere in the path.

## What Was Implemented

1. **Backend — forwarded-host gateway** (`app/Http/Middleware/ResolveStorefrontDomain.php`, `config/storefront.php`): a new `incomingHostname()` method reads `X-Storefront-Forwarded-Host` **only** when accompanied by a valid `X-Storefront-Gateway-Secret` (constant-time `hash_equals` against `STOREFRONT_GATEWAY_SECRET`, a server-only env var). Any mismatch, missing secret, or unconfigured secret falls back to the original `$request->getHost()` behavior — the exact, unmodified P2A resolution algorithm. This is a new *transport* input to the same resolver, not a second resolution mechanism.
2. **Backend — storefront config endpoint** (`app/Http/Controllers/Api/StorefrontConfigController.php`): `GET store/v1/storefront` returns `{"data": {"default_locale": string|null}}` from the resolved `Storefront` row (`null` on the legacy `{tenantSlug}` path, which resolves no `Storefront`). Wired into both route groups in `routes/api_storefront.php`.
3. **Frontend — production storefront identity** (`storefront/src/lib/commerce/config.ts`): `AWJ_STORE_TENANT_SLUG` removed entirely. `storefrontFetch()` now builds tenant-slug-free URLs (`store/v1/...`) and resolves the visitor's real hostname via `next/headers`' `headers().get("host")`, sent as the forwarded-host header (+ secret, if configured). `AWJ_STOREFRONT_DEV_HOST` is a new non-production-only override (never read when `NODE_ENV === "production"`) for local development without a real DNS/`StorefrontDomain` record — mirrors the backend's own non-production-only `{tenantSlug}` route.
4. **Frontend — Arabic locale registration** (`storefront/messages/ar.json`, `storefront/src/i18n/locales.ts`): full Arabic translation of all 564 message keys (parity-checked against `en.json`), `ar` registered in `MESSAGE_LOADERS`, `DEFAULT_LOCALE` changed from `"en"` to `"ar"`. `storefront/src/lib/store.ts`'s `getDefaultLocale()` fallback also changed to `"ar"`.
5. **Frontend — Storefront-driven default locale** (`storefront/src/lib/commerce/storefront.ts`, `storefront/src/lib/data/markets.ts`): the single static AWJ Market's `default_locale` now comes from the resolved `Storefront.default_locale` (via the new config endpoint) when it names a locale the storefront actually supports; falls back to `"ar"` on any error, unsupported value, or `null`. `supported_locales` is now `["ar", "en"]` (was `["en"]` only).
6. **Frontend — RTL/LTR fixes**: ~30 physical-direction Tailwind class fixes across 15 components (margins/padding/absolute-position → logical `ms-/me-/ps-/pe-/start-/end-`, `text-left` → `text-start`), directional chevron/arrow icon mirroring (`rtl:rotate-180`) in `MobileMenu`, `ProductCarousel`, `MediaLightbox`, and locale-aware drawer slide-side (`MobileMenu`, `MobileFilterDrawer` open from the reading-start edge; `CartDrawer` from the reading-end edge) instead of a hardcoded physical side.
7. **Frontend — bilingual product names**: `mapAwjProductToViewModel()` now accepts an optional `locale` and returns `product.name_en` (falling back to `product.name`) when the locale is English; `commerce/products.ts` resolves the current locale via the existing `getLocaleOptions()` (same cookie-based mechanism `src/lib/data/markets.ts` already used) and passes it through.
8. **CI**: added a `pnpm check:locales` step to `storefront-ci.yml` (the existing `check-locale-parity.ts` script was written but never wired into CI) so a future locale falling out of sync with `en.json` fails the build.

## Changed Files

### Backend

| File | Change |
|------|--------|
| `app/Http/Middleware/ResolveStorefrontDomain.php` | Added `incomingHostname()` (secret-gated forwarded-host gateway) |
| `config/storefront.php` | New — `gateway_secret` from `STOREFRONT_GATEWAY_SECRET` |
| `app/Http/Controllers/Api/StorefrontConfigController.php` | New — `GET storefront` config endpoint |
| `routes/api_storefront.php` | Added `storefront` route to both route groups |
| `tests/Feature/StorefrontGatewayAndConfigTest.php` | New — 9 tests |
| `.github/workflows/storefront-ci.yml` | Added locale-parity CI step |

### Frontend

| File | Change |
|------|--------|
| `src/lib/commerce/config.ts` | Rewritten: hostname-based identity, forwarded-host + secret, `AWJ_STOREFRONT_DEV_HOST` |
| `src/lib/commerce/storefront.ts` | New — `fetchStorefrontDefaultLocale()` |
| `src/lib/commerce/mappers.ts` | `mapAwjProductToViewModel(product, locale?)` — bilingual name selection |
| `src/lib/commerce/products.ts` | Resolves locale via `getLocaleOptions()`, passes to mapper |
| `src/lib/data/markets.ts` | `staticAwjMarket()` async; `default_locale` from Storefront config, `supported_locales: ["ar","en"]` |
| `src/lib/store.ts` | `getDefaultLocale()` fallback `"en"` → `"ar"` |
| `src/i18n/locales.ts` | `ar` registered; `DEFAULT_LOCALE` → `"ar"` |
| `messages/ar.json` | New — full Arabic translation (564 keys, parity-checked) |
| `.env.example` | `AWJ_STORE_TENANT_SLUG` removed; `STOREFRONT_GATEWAY_SECRET`/`AWJ_STOREFRONT_DEV_HOST` documented |
| `src/components/{cart/CartDrawer,checkout/PaymentSection,products/VariantPicker,addresses/AddressManagement,products/ProductCard}.tsx` | Physical → logical direction classes |
| `src/components/ui/{button,badge,dropdown-menu,native-select,input-group,dialog,alert-dialog,alert,sheet,field}.tsx` | Physical → logical direction classes |
| `src/components/layout/MobileMenu.tsx` | Logical position class, icon mirroring, locale-aware drawer side |
| `src/components/products/filters/MobileFilterDrawer.tsx` | Locale-aware drawer side |
| `src/components/cart/CartDrawer.tsx` | Locale-aware drawer side, side-agnostic width classes |
| `src/components/products/ProductCarousel.tsx`, `MediaLightbox.tsx` | Logical position classes, icon mirroring |
| `src/lib/commerce/__tests__/{config,products,categories,mappers}.test.ts` | New/updated — hostname/gateway/locale tests |
| `src/lib/data/__tests__/markets.test.ts` | New — 6 tests |
| `src/app/[country]/[locale]/layout.test.tsx` | +2 tests (Arabic default, locale-switch no-redirect) |
| `src/components/layout/DocumentShell.test.tsx` | +2 tests (explicit ar/en dir assertions) |
| `src/components/layout/__tests__/MobileMenu.test.tsx` | Updated mock (`useLocale`) |

## Architecture/Security Decisions Actually Enforced

- **No competing resolution mechanism.** `ResolveStorefrontDomain`'s core chain (`StorefrontDomain` → `Storefront` → `SalesChannel`, fail-closed at every step, `TenantScope`-backed re-verification) is **byte-for-byte unchanged**. The only addition is an alternate, secret-gated source for the *hostname string* fed into that same chain.
- **The forwarded-host header is never trusted from an unauthenticated caller.** `hash_equals()` (constant-time) against a server-only secret that never reaches the browser (`STOREFRONT_GATEWAY_SECRET` is read only in `config/storefront.php` on the backend and `storefront/src/lib/commerce/config.ts` on the frontend — never `NEXT_PUBLIC_*`). An attacker hitting `store/v1/*` directly with a forged header and no correct secret is treated identically to sending no header at all, falling back to `$request->getHost()` (Laravel's own domain, matching no `StorefrontDomain` row → 404).
- **`AWJ_STOREFRONT_DEV_HOST` can never become a production authority.** Gated on `process.env.NODE_ENV !== "production"` in the same function that reads the real Host header — structurally identical to the backend's own `ResolveStorefrontTenant` non-production guard from P2A.
- **Locale is never tenant/store authority.** Nothing in the resolution chain reads locale. The `Storefront.default_locale` field flows in exactly one direction: backend config → frontend UI language choice. It never influences which `Storefront`/`Tenant`/`SalesChannel` gets resolved.
- **No new persistence for bilingual content beyond what already existed.** `products.name_en` was already a persisted column (used since COM-7-P1's fixtures/resource) — this PR only wires the *frontend* to actually use it. No column, table, or translation subsystem was added.

## Store/Tenant/SalesChannel Resolution Behavior

Production resolution is unchanged in algorithm, changed only in transport:

```
Visitor's browser → Host: shop.example.com → Next.js server
                                                  │
                                    reads real Host via next/headers
                                                  │
                          storefrontFetch() → Laravel store/v1/...
                          + X-Storefront-Forwarded-Host: shop.example.com
                          + X-Storefront-Gateway-Secret: <shared secret>
                                                  │
                    ResolveStorefrontDomain: secret valid? → use forwarded host
                                              secret invalid/absent? → use $request->getHost()
                                                  │
                    StorefrontDomain → Storefront → Tenant → SalesChannel (fail-closed, unchanged from P2A)
                                                  │
                                       trusted StorefrontContext
```

**Verified locally end-to-end** (live Laravel backend, `next build` + standalone production server, real curl requests with `Host: awj-preview.local`):
- Both `/sa/ar/products` and `/sa/en/products` correctly resolved the seeded tenant's 5 published products through the full chain.
- `AWJ_STOREFRONT_DEV_HOST`/no-`STOREFRONT_GATEWAY_SECRET` and `STOREFRONT_GATEWAY_SECRET` configured on both sides were both tested; only the latter reaches real production data through the forwarded-host path (the former hits the legacy dev-slug-free host resolution, which requires the connecting Host itself to already match a registered domain).
- Confirmed via `StorefrontGatewayAndConfigTest` (backend, 9 tests) and `config.test.ts` (frontend, 7 tests) that a wrong or missing secret never lets the forwarded host take effect.

## Arabic/English Implementation

- `messages/ar.json`: complete translation of all 564 keys across all 23 top-level namespaces (`common`, `header`, `products`, `checkout`, `wholesale`, etc.) — including sections outside COM-7-P2B's functional scope (checkout, wholesale, account), because `scripts/check-locale-parity.ts` requires full key parity across all locale files (a partial `ar.json` would fail this pre-existing repo-wide gate, and the other four bundled locales — de/es/fr/pl — are already fully translated for the same reason).
- `DEFAULT_LOCALE` is now `"ar"` (was `"en"`) in `src/i18n/locales.ts`; `getDefaultLocale()` in `src/lib/store.ts` falls back to `"ar"` when `NEXT_PUBLIC_DEFAULT_LOCALE` is unset (the `.env.example` default was already `ar`, but the code fallback itself was still `en` until this PR).
- The Market's `default_locale` is driven by the resolved `Storefront.default_locale` (new `GET store/v1/storefront` endpoint) when it names a locale the storefront actually renders (`ar` or `en` today); otherwise falls back to `"ar"`.
- Product names: `name_en` is used for the English UI, `name` (Arabic) for Arabic, with a safe fallback to the Arabic name if `name_en` is null — verified by both unit tests and live end-to-end rendering.

## RTL/LTR Implementation

- `DocumentShell.tsx`'s `<html lang dir>` wiring was already correct pre-existing code (`localeDirection()`); this PR did not need to touch it, only registering `ar` was required to activate it — confirmed by new explicit `ar`/`en` test cases.
- Fixed ~30 physical-direction Tailwind utility occurrences across 15 files (see Changed Files): margins/paddings (`ml-/mr-/pl-/pr-` → `ms-/me-/ps-/pe-`), absolute positions (`left-/right-` → `start-/end-`), and text alignment (`text-left` → `text-start`).
- Mirrored directional chevron/arrow icons (`rtl:rotate-180`, a pure-CSS Tailwind `rtl:` variant keyed off the `<html dir="rtl">` ancestor — zero component-logic changes) in the mobile nav back-button/disclosure chevrons, the product image carousel prev/next controls, and the media lightbox prev/next controls.
- Made the three side-drawers (`MobileMenu`, `MobileFilterDrawer`, `CartDrawer`) open from the semantically-correct edge (reading-start for navigation/filters, reading-end for the cart) based on `localeDirection(useLocale())`, instead of a hardcoded `side="left"`/`"right"`.
- **Deferred, documented, not fixed in this PR:** keyboard arrow-key handling in `MediaLightbox` (`ArrowLeft`/`ArrowRight` key bindings for prev/next) does not swap direction in RTL — a real but lower-visibility nuance affecting only keyboard-navigation users, left for a follow-up rather than risking destabilizing tested interaction logic within this PR's scope.

## Bilingual Product/Category Persistence Finding

- **Products: no schema gap.** `products.name` (Arabic) and `products.name_en` (English) already exist as persisted columns (confirmed via the existing `Product` model, `StorefrontCatalogApiTest` fixtures, and `StorefrontProductResource`, all predating this PR). The only gap was that the **frontend never read `name_en`** — fixed in this PR (see above), using zero new persistence.
- **Categories: real schema gap, left undecided.** `product_categories` has only a single `name` column — no English (or any other second-language) equivalent exists anywhere in the current schema. This PR does **not** add one, per the explicit stop condition ("Do NOT invent a translation table... modify Product/Category schema"). Category names render in Arabic regardless of the active storefront locale today; an English-locale visitor sees Arabic category names. This is the **smallest concrete architecture decision required later**: whether to add a `name_en` column to `product_categories` (mirroring `products`' existing precedent exactly) or a more general translation table/JSON column for categories (and eventually products, if `name`/`name_en` proves too narrow for future languages). That decision is explicitly deferred to product/architecture ownership, not implemented here.

## Tests Executed and Exact Results

### Backend — SQLite

```
php artisan test --filter="StorefrontGatewayAndConfigTest|StorefrontDomainResolutionApiTest|StorefrontModelTest|HostnameNormalizerTest|StorefrontCatalogApiTest|BranchIsolationGuardTest"
Tests:    68 passed (274 assertions)
```

### Backend — PostgreSQL 16

```
php artisan test --filter="StorefrontGatewayAndConfigTest|StorefrontDomainResolutionApiTest|StorefrontModelTest|HostnameNormalizerTest|StorefrontCatalogApiTest|BranchIsolationGuardTest|LedgerTest"
Tests:    73 passed (284 assertions)
```

### Backend — full suite, PostgreSQL

```
php artisan test
Tests:    27 failed, 3407 passed (21910 assertions)
Duration: 780.33s
```

The 27 failures are the same pre-existing, unrelated `FuelCostBasisService` failures documented in every prior COM-7 report (missing `bcmul()` in this sandbox) — same count as the P2A baseline. No regression introduced by this PR on PostgreSQL.

### Frontend — Vitest

```
pnpm vitest run
Test Files  39 passed (39)
     Tests  291 passed (291)
```

291 = 267 pre-existing (COM-7-P1/P2A baseline) + 24 new: `config.test.ts` (7, new file), `markets.test.ts` (6, new file), `layout.test.tsx` (+2, Arabic default + locale-switch no-redirect), `DocumentShell.test.tsx` (+2, explicit ar/en dir), `mappers.test.ts` (+4, name_en cases), `products.test.ts` (+3, name_en cases).

### Frontend — TypeScript

```
npx tsc --noEmit → no errors
```

### Frontend — Biome

```
pnpm check → Checked 283 files, no errors
```

### Frontend — Locale parity

```
pnpm check:locales
[ar] OK — all keys match en.json
[de] OK — all keys match en.json
[es] OK — all keys match en.json
[fr] OK — all keys match en.json
[pl] OK — all keys match en.json
```

## Frontend Production Build Result

```
pnpm build → exit 0
```

Default static param generated: `/sa/ar` (was `/sa/en` under P1) — confirms `DEFAULT_LOCALE="ar"` took effect through the build's static generation. All routes report `◐`/`ƒ`/`○` as expected (no route required a live backend to complete static generation, matching P1's established build shape).

**Runtime verification** (`node .next/standalone/server.js`, against a live Laravel backend seeded with tenant `awj-storefront-dev`, `Storefront` `default_locale=ar`, `StorefrontDomain` `awj-preview.local`, and 5 published products), with `STOREFRONT_GATEWAY_SECRET` configured identically on both sides:

| Request | Result |
|---|---|
| `GET /sa/ar/products` (Host: `awj-preview.local`) | 200, `<html lang="ar" dir="rtl">`, all 5 products shown with Arabic names (`منتج تجريبي 1`..`5`) |
| `GET /sa/en/products` (Host: `awj-preview.local`) | 200, `<html lang="en" dir="ltr">`, all 5 products shown with English names (`Demo Product 1`..`5`) |
| `GET /sa/ar/products/{id}` | 200, real SKU (`DEMO-1`), SAR-formatted price (`ر.س`/`SAR`) |
| `GET /sa/ar/c/{categoryId}` | 200, real category name (`إلكترونيات`) |

This is the first time the storefront has rendered real bilingual data resolved purely from an HTTP `Host` header, with no tenant identifier anywhere in the URL, cookie, or query string — the exact target architecture for this phase.

**Note on `next.config.ts`'s `output: "standalone"`**: `next start` (the command in `package.json`'s `start` script) is documented by Next.js itself as incompatible with `output: "standalone"` and does not correctly load environment variables written to `.env.local` after the last build (a pre-existing project configuration fact, not something this PR changed) — the correct runtime command for this project's configuration is `node .next/standalone/server.js` (with `.env`/`static`/`public` copied alongside, matching Next.js's own standalone deployment docs), which is what was used for the verification above.

## CI Status

GitHub Actions: pending — will be confirmed after the PR is opened and pushed. `storefront-ci.yml` now also runs `pnpm check:locales`.

## Risks

1. **Category names do not localize** (documented gap above) — an English-locale visitor sees Arabic category names/breadcrumbs. Cosmetic, not a security or data-isolation concern; the smallest fix (mirroring `products.name_en`) is scoped and named above for a follow-up decision.
2. **`MediaLightbox` keyboard arrow-key navigation does not flip direction in RTL** — a real, low-visibility RTL nuance, deliberately not touched to avoid destabilizing tested keyboard-interaction logic within this PR's scope.
3. **Shared secret operational risk**: `STOREFRONT_GATEWAY_SECRET` is a conventional shared-secret credential — if leaked, it lets the holder claim any hostname as "forwarded" (though this only lets them read the *catalog* of whatever tenant that hostname's `StorefrontDomain` resolves to — still fully scoped to the same read-only, non-sensitive-field catalog surface P1/P2A already established; no cost/margin/customer data is reachable through any spoofed hostname). Standard secret-management practice (env-only, rotated like any API key) applies, matching every other credential already in this codebase (`ApiClient` tokens, etc.).
4. **No IDN/punycode support** was already a documented P2A limitation; unaffected/unchanged by this PR.
5. **Font**: `Geist` (Latin-only) remains the storefront's variable font; Arabic renders via browser font-fallback (functionally correct, not the AWJ Store default-design-direction's ultimately-intended Tajawal). Out of scope per "no broad visual redesign" — noted, not fixed.

## Deferred Items

- Category bilingual names (schema decision required — see finding above).
- `MediaLightbox` keyboard arrow-key RTL flip.
- Tajawal (or another Arabic-optimized) font — deferred design polish, not a P2B blocker.
- Full custom-domain DNS/SSL automation (unchanged from P2A — explicitly out of scope here too).
- A merchant-facing admin UI to create/manage `Storefront`/`StorefrontDomain` rows (still none exists; this PR, like P2A, creates them only via direct `Model::create()` in tests/seed scripts).
- COM-7 phases beyond P2B (cart, checkout, payment, etc.) — untouched, as instructed.

## Confirmation: Excluded Scope

**Not implemented in this PR**, as instructed: cart, checkout, payment, shipping, fulfillment redesign, Order → Invoice, customer address book, DNS verification automation, SSL provisioning, App Builder, marketplace, broad Commerce Workspace/admin implementation, theme/page-builder redesign, accounting changes, inventory semantics changes, branch/warehouse semantics changes, broad storefront visual redesign, production deployment. No `CommerceOrder`/`InventoryReservation`/`SalesChannel` semantics were changed. No new database table/column was added — the only backend schema-adjacent addition is `config/storefront.php` (a config file, not a migration).

## Recommended Next Step

Decide the category bilingual-name persistence question named above (smallest option: mirror `products.name_en` onto `product_categories`), then a small follow-up PR to wire it through the same mapper pattern this PR established for products. Separately, COM-7-P3 (Cart Contract) is the next major phase per the master plan, once a merchant-facing `Storefront`/`StorefrontDomain` admin surface exists to actually onboard real tenants onto this resolution chain outside of test/seed scripts.
