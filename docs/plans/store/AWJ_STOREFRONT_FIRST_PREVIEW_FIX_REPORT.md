# AWJ Storefront — First Live Preview Runtime Failures Fix Report

**Task:** COM-7-PREVIEW-FIX-1
**Date:** 2026-09-12
**Base:** `50b11b88761682597a418f1c2d465fce2a45e4f8` (main, includes merged PR #777 — deployment prep; merge SHA `3e0bd8313e1e1ad94fadc80fd1f54a62c0e1cfc0` confirmed on this history)
**Live hostname observed:** `storefront-one-xi.vercel.app`
**Live backend:** `https://nibras-api-production.up.railway.app` (Railway, `STOREFRONT_GATEWAY_SECRET` already set on both sides per task input — not printed, rotated, or touched here)

## 1. Root Cause — Spree Runtime Call

`getCart()` in `storefront/src/lib/data/cart.ts` constructed the Spree SDK client **unconditionally**, before its own early-return guard for a visitor with no cart cookie and no auth token:

```ts
const cartId = explicitCartId ?? (await getCartId(surface));
const client = getClientForSurface(surface);   // ← always runs

if (!cartId && !token) return null;            // ← guard never reached first
```

`getClientForSurface()` → `getClient()` throws synchronously — *"Spree client is not configured..."* — whenever `SPREE_API_URL`/`SPREE_PUBLISHABLE_KEY` are unset, which is the **correct** state for this AWJ-backed preview (the task explicitly forbids setting them). `CartProvider` (in `CartContext.tsx`) mounts unconditionally on every `/sa/{locale}` page load and calls this function via a Server Action on mount — so **every first-time visitor**, with zero cart and zero login, triggered this throw. This matches the task's evidence exactly (stack referencing `storefront/src/lib/spree/config.ts` and `storefront/src/lib/data/*`).

## 2. Exact Old Call Path

```
/sa/ar page load
  → CountryLocaleLayout → CountryLocaleProviders → CartProvider (mounts, "use client")
    → refreshCart() effect → getCartAction() [Server Action, "use server"]
      → lib/data/cart.ts: getCart()
        → getClientForSurface("dtc")   ← throws unconditionally, before the
                                           `if (!cartId && !token) return null`
                                           guard that should have short-circuited it
```

## 3. Exact Replacement/AWJ Path

No AWJ routing was needed here — cart/checkout is explicitly out of scope for this preview (P3, not this task). The fix is the **minimal, narrow bug fix** the task asked for: restore the guard's original intent by constructing the client only when a lookup is actually required (i.e., only when `cartId` or `token` is present):

```ts
const cartId = explicitCartId ?? (await getCartId(surface));

if (!cartId && !token) return null;   // fresh visitor — no Spree client touched at all

const client = getClientForSurface(surface);   // only reached when a real lookup is needed
```

This is a pure reordering of two existing lines — no new domain behavior, no Spree backend configured, no second commerce source of truth. A fresh COM-7-P1 preview visitor (no cart, no login) now never requires Spree to be configured. Cart/checkout for an authenticated user or one who already has a cart cookie is **unchanged** (still Spree-backed, as it already was before this task — out of scope to alter).

**File:** `storefront/src/lib/data/cart.ts`

## 4. Root Cause for Each Observed 404

**Confirmed by code + tests, not just inspection**: the 404 is caused by `storefront-one-xi.vercel.app` having **no matching row in `storefront_domains`** — exactly the fail-closed behavior `ResolveStorefrontDomain` is designed to produce (`app/Http/Middleware/ResolveStorefrontDomain.php`):

```
Host resolved (forwarded-host + secret, verified working per task input)
  → HostnameNormalizer::normalize() — passes (well-formed hostname)
  → StorefrontDomain::query()->where('hostname', $hostname)->first()
      → NULL — no row exists for this hostname yet
  → abort(404, 'تعذّر تحديد متجر صالح.')
```

This is **not a bug** — it is the documented, tested fail-closed contract (`StorefrontDomainResolutionApiTest::unknown_hostname_fails_closed`, re-run green in this task, §8 below). The categories 404 (`StorefrontLayout: failed to load categories`) is already caught and degrades to an empty nav — that pattern existed before this task. The **second, uncaught** 404 (`AWJ storefront API request failed (404)`, no calling-component prefix) came from `FeaturedProducts` → `cachedListProducts` → `fetchProducts`, which had **no error handling at all** — an uncaught rejection in an async Server Component crashes that render tree, and this is very likely the direct cause of the page's HTTP 500 (categories' own 404 was already non-fatal; this one was not).

**Fix applied**: `FeaturedProducts.tsx` now catches a failed catalog fetch and degrades to an empty product list — mirroring the exact defensive pattern `StorefrontLayout`'s `getRootCategories` already used for categories. This does not change the 404's root cause (still needs §5/§6) but ensures a catalog outage degrades the homepage instead of crashing it, consistent with the rest of the page.

**File:** `storefront/src/components/products/FeaturedProducts.tsx`

## 5. Is Live Hostname Registration Still Required?

**Yes.** No code change removes the need for a real `StorefrontDomain` row. This is a data/registration gap, not a defect — by design, per the fail-closed architecture. Per the task's explicit instruction ("Do NOT guess which production tenant/store/channel should own it... If production DB access is unavailable, STOP before any DB write"): **this session has no access to the live Railway/production database**, so the row was **not created**. See §6 for the exact operator command.

## 6. Exact Safe Operator Command

A new, idempotent Artisan command — `app/Console/Commands/RegisterStorefrontDomainCommand.php` — was added specifically so this never has to be hand-run via ad-hoc tinker again. It:

- Requires the operator to supply the tenant explicitly (`id` or `slug`) — **never guesses, never creates a tenant**.
- Normalizes the hostname through the existing `HostnameNormalizer` (the same one `StorefrontDomain::setHostnameAttribute()` and `ResolveStorefrontDomain` both use).
- Refuses to touch a hostname already owned by a **different** tenant (hard failure, no silent transfer).
- Requires an existing **active `web`-type `SalesChannel`** for that tenant — **never creates one** (a sales channel is a real commercial decision, out of scope for a domain-registration command). Fails clearly, listing the ambiguity, if the tenant has zero or more than one such channel (use `--channel=<id-or-slug>` to disambiguate).
- Creates the `Storefront` only if none exists yet for that channel (`firstOrCreate` — safe, no accounting/inventory side effects).
- Creates or re-confirms the `StorefrontDomain` as `is_active=true`, `verification_status=verified` — safe to re-run (idempotent: running it again with the same inputs changes nothing further).
- Never sets `is_primary` unless `--make-primary` is explicitly passed (never silently demotes an existing primary domain).
- Prompts for confirmation before writing, unless `--yes` is passed (for non-interactive operator use).

**Run once, on the deployed backend**, after the operator confirms which tenant `storefront-one-xi.vercel.app` should preview:

```bash
php artisan storefront:register-domain <tenant-id-or-slug> storefront-one-xi.vercel.app --yes
```

If the tenant has more than one active `web` sales channel:

```bash
php artisan storefront:register-domain <tenant-id-or-slug> storefront-one-xi.vercel.app --channel=<channel-id-or-slug> --yes
```

Both forms are safe to re-run. Neither creates a tenant, a sales channel, or touches any other tenant's data.

## 7. Files Changed

| File | Change |
|---|---|
| `storefront/src/lib/data/cart.ts` | Move `getClientForSurface()` construction after the early-return guard in `getCart()` |
| `storefront/src/components/products/FeaturedProducts.tsx` | Catch a failed catalog fetch, degrade to an empty product list (mirrors existing category-nav pattern) |
| `storefront/src/lib/data/__tests__/cart.test.ts` | New regression test: fresh visitor never constructs the Spree client |
| `storefront/src/components/products/__tests__/FeaturedProducts.test.tsx` | New: catalog failure degrades gracefully; success path unaffected |
| `app/Console/Commands/RegisterStorefrontDomainCommand.php` | New idempotent operator command (§6) |
| `tests/Feature/RegisterStorefrontDomainCommandTest.php` | New: 6 tests covering the command's safety invariants |
| `docs/plans/store/AWJ_STOREFRONT_FIRST_PREVIEW_FIX_REPORT.md` | This report |

No other files changed. No migrations. No accounting/inventory/invoice/reservation code touched. No architecture, resolution algorithm, or existing API touched beyond the two narrow bug fixes above.

## 8. Tests and Exact Results

**Backend** (`php artisan test`, run against a fresh `migrate:fresh` SQLite build from this exact branch):

```
--filter="StorefrontGatewayAndConfigTest|StorefrontDomainResolutionApiTest|StorefrontModelTest|HostnameNormalizerTest|StorefrontCatalogApiTest|BranchIsolationGuardTest|RegisterStorefrontDomainCommandTest"

Tests:    74 passed (294 assertions)
```

(68 pre-existing + 6 new `RegisterStorefrontDomainCommandTest` tests — all pass, zero regressions.)

**Full backend suite** (`php artisan test`, no filter): 3433 passed, 19 skipped, 27 failed. **All 27 failures are pre-existing, unrelated to this task** — `FuelReconciliationTest`/`FuelSaleServiceTest`/`FuelSupplyReceivingTest`/`FuelAviRfidServiceTest` (petroleum fuel cost-basis calculations requiring the `bcmath` PHP extension, not installed in this sandbox) and one `DocumentCenterSecureIntakeTest` case — none touch storefront, cart, catalog, or tenant-resolution code. Confirmed by name-matching every failure; zero overlap with files changed in §7.

**Storefront** (`pnpm vitest run`):

```
Test Files  40 passed (40)
Tests       294 passed (294)
```

Includes the 2 new `FeaturedProducts.test.tsx` tests and the 1 new `cart.test.ts` test (17 total in that file, up from 16).

**Locale parity** (`pnpm check:locales`): all 5 locale files (ar/de/es/fr/pl) match `en.json` — no new strings were added by this fix, so no translation gap introduced.

## 9. Storefront Production Build Result

```
pnpm build → exit 0
```

Full route tree generated successfully, including every `/[country]/[locale]/...` route. No new build warnings introduced by the two changed files.

## 10. Security / Tenant Isolation Verification

No security-relevant code was touched — `ResolveStorefrontDomain`, `HostnameNormalizer`, `StorefrontContext`, and the gateway-secret comparison are byte-for-byte unchanged. Re-ran the full existing isolation suite to confirm (§8): domain A/B cross-tenant isolation, unknown/malformed/inactive/unverified-domain fail-closed, inactive Storefront/SalesChannel fail-closed, client-supplied tenant-id/header/cookie/query spoofing rejected, gateway-secret validation (missing/incorrect secret ignored, falls back safely to `$request->getHost()`), locale-switch identity stability — **all still pass, zero changes in behavior**.

The new `RegisterStorefrontDomainCommand` was itself tested for the same class of invariants (§8, `RegisterStorefrontDomainCommandTest`): refuses to move a hostname to a different tenant, refuses to guess a tenant, refuses to invent a sales channel, requires explicit disambiguation when ambiguous, is idempotent.

## 11. Remaining Blockers to a Successful Live Preview

1. **`storefront-one-xi.vercel.app` still has no `StorefrontDomain` row** — §6's command must be run once the operator confirms which tenant/channel it should preview. This alone is expected to resolve the 404s (categories + featured products) once run.
2. This session still has **no access to the live Railway/production database or shell** — the command in §6 must be executed by someone who does (same constraint as the prior deployment-prep task).
3. Once §11.1 is resolved, re-verify `/sa/ar` and `/sa/en` against the live URL (Arabic/English rendering, RTL/LTR, same store identity, no 500) — not yet possible to confirm from this sandbox.

## 12. Branch

`claude/storefront-preview-fix-1`

## 13. PR Number/Link

[#779](https://github.com/safwan5001-source/Nebrax/pull/779)

## 14. Base SHA

`50b11b88761682597a418f1c2d465fce2a45e4f8` (main; includes PR #777, deployment prep)

## 15. Head SHA

`902d5822615d48a5001540ac4a3c0d01f2666878` (includes a formatting-only follow-up fixing a `biome check` CI failure in the two new test files — no logic change)

## 16. Risks / Remaining Work

- **Risk: none to existing production systems.** No migration, no Railway/Render config touched, no accounting/inventory/invoice/stock code touched.
- **Remaining work**: §6's one-time command execution (needs an operator with DB access) is the only step left before the preview can render without 500s. After that, a full live Arabic/English/security re-verification (per the original Preview Gate's §6–§9 methodology) should be run against the real URL.
- The Spree-backed cart/checkout code paths (`lib/data/cart.ts`, `checkout.ts`, `payment.ts`, etc.) remain entirely Spree-shaped and unconfigured in this preview — untouched by design, since Cart/Checkout is explicitly COM-7-P3, not this task. They will throw if a user actually tries to use the cart in this preview (add-to-cart, checkout) — that is expected and out of scope; the fix in this task only stops the **passive, involuntary** Spree client construction that fired on every page load regardless of user action.

## 17. Exact Next Action

1. **Merge this PR** (after Safwan's explicit approval — not done automatically per task instructions).
2. **Run §6's command once** against the live Railway backend, after confirming the target tenant with Safwan:
   ```bash
   php artisan storefront:register-domain <tenant-id-or-slug> storefront-one-xi.vercel.app --yes
   ```
3. **Reload `https://storefront-one-xi.vercel.app/sa/ar`** — expect a 200 with real catalog data instead of a 500.
4. Re-run the original Preview Gate's live verification checklist (Arabic/English rendering, RTL/LTR, security/isolation) against the real URL and update `AWJ_STOREFRONT_FIRST_PREVIEW_DEPLOYMENT_REPORT.md` with the real results.

**Do not merge. Do not deploy. Do not write production DB data.** All per this task's explicit instructions — stopping here after the PR and this report.
