<?php

use App\Http\Controllers\Api\CommerceCartController;
use App\Http\Controllers\Api\CommerceCategoryController;
use App\Http\Controllers\Api\CommerceProductController;
use App\Http\Controllers\Api\CommerceStorefrontController;
use App\Http\Middleware\AuthenticateApiClient;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnforcePublicApiRateLimit;
use App\Http\Middleware\PublicApiRequestAudit;
use App\Http\Middleware\PublicApiTenantGuard;
use App\Http\Middleware\ResolveCommerceChannel;
use App\Support\PublicApiRateLimits;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public/Mobile Commerce API — v1  (PR-1: Skeleton + Identity/Config;
| PR-2: Read-only Catalog; PR-3: Guest Cart)
|--------------------------------------------------------------------------
| Loaded via App\Providers\CommerceApiServiceProvider under prefix
| `commerce/v1`, with its own middleware group and error envelope. Reference:
| docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md.
|
| Store-token decision (PR-1, see ResolveCommerceChannel's docblock for the
| full reasoning): the existing ApiClient + Sanctum bearer-token mechanism
| already used by /api/v1 *is* the mobile store token — no new auth system,
| no new schema. AuthenticateApiClient is reused completely unmodified.
|
| Security chain per route (mirrors /api/v1's own read chain exactly, with
| ResolveCommerceChannel inserted right after tenant resolution):
|   AuthenticateApiClient   → resolves ApiClient from bearer token, sets
|                             TenantContext from the client's own tenant_id
|                             (never client-supplied)
|   PublicApiTenantGuard    → fail-closed if TenantContext is somehow absent
|   ResolveCommerceChannel  → resolves the tenant's single active `mobile`
|                             SalesChannel (zero client input) via
|                             MobileSalesChannelResolver; 404 fail-closed on
|                             missing/inactive channel
|   PublicApiRequestAudit   → same audit trail /api/v1 already writes
|   EnforcePublicApiRateLimit:read → same rate-limit classes/policy
|   EnsureActiveSubscription → same subscription gate as /api/v1 and the
|                             Internal API
|
| Out of scope for PR-1 (explicit): no PublicApiScope case is introduced —
| there is no protected resource yet to gate beyond "a valid, active client
| of this tenant with a provisioned mobile channel". Catalog/Cart/Checkout
| in later PRs may warrant one once a real resource needs narrower scoping.
*/
Route::middleware([
    AuthenticateApiClient::class,
    PublicApiTenantGuard::class,
    ResolveCommerceChannel::class,
    PublicApiRequestAudit::class,
    EnforcePublicApiRateLimit::class . ':' . PublicApiRateLimits::CLASS_READ,
    EnsureActiveSubscription::class,
])->group(function () {
    Route::get('storefront', [CommerceStorefrontController::class, 'show'])->name('storefront.show');

    // PR-2 — read-only catalog. Categories carry no publication/channel gate
    // (shared browsing structure); products are gated by CommerceListing on
    // the resolved mobile sales channel, exactly as /store/v1's equivalent
    // route is gated by the resolved web channel — see CommerceProductController.
    Route::get('categories', [CommerceCategoryController::class, 'index'])->name('categories.index');
    Route::get('categories/{id}', [CommerceCategoryController::class, 'show'])->whereUuid('id')->name('categories.show');

    Route::get('products', [CommerceProductController::class, 'index'])->name('products.index');
    Route::get('products/{id}', [CommerceProductController::class, 'show'])->whereUuid('id')->name('products.show');

    // PR-3 — guest cart read. Reuses CommerceCartService in full; identity is
    // the X-Cart-Token header (see CommerceCartController's own docblock),
    // never the Authorization header, which already carries the unrelated
    // ApiClient/Sanctum store token resolved above.
    Route::get('cart', [CommerceCartController::class, 'show'])->name('cart.show');
});

/*
|--------------------------------------------------------------------------
| PR-3 — guest cart mutations
|--------------------------------------------------------------------------
| Same chain as the read group above, with EnforcePublicApiRateLimit:write
| in place of :read — mirrors /api/v1's own read/write split exactly. No
| Idempotency-Key requirement: /store/v1's cart mutations have none either
| (only its checkout does), and AWJ_CART_V1_ARCHITECTURE.md §18 explicitly
| documents that Cart V1 has no request-level idempotency contract by
| design — this stays consistent with that, not inventing a new guarantee.
*/
Route::middleware([
    AuthenticateApiClient::class,
    PublicApiTenantGuard::class,
    ResolveCommerceChannel::class,
    PublicApiRequestAudit::class,
    EnforcePublicApiRateLimit::class . ':' . PublicApiRateLimits::CLASS_WRITE,
    EnsureActiveSubscription::class,
])->group(function () {
    Route::post('cart/items', [CommerceCartController::class, 'store'])->name('cart.items.store');
    Route::patch('cart/items/{item}', [CommerceCartController::class, 'update'])->whereUuid('item')->name('cart.items.update');
    Route::delete('cart/items/{item}', [CommerceCartController::class, 'destroy'])->whereUuid('item')->name('cart.items.destroy');
});
