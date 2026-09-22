<?php

namespace App\Providers;

use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestContext;
use App\Http\Middleware\ResolveCommerceLocale;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Services\Commerce\Otp\OtpProvider;
use App\Support\PublicApiExceptionRenderer;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — PR-1 (Skeleton + Identity/Config)
 * ═══════════════════════════════════════════════════════════════
 *
 *  Registers `/commerce/v1/*` as its own independent layer, deliberately
 *  mirroring `PublicApiServiceProvider`'s structure verbatim rather than
 *  extending `/store/v1` (architecture doc §3.1 — `/store/v1` stays
 *  untouched; `/commerce/v1` is a new, separate trust boundary that shares
 *  Commerce services, not routes or middleware, with either existing layer):
 *
 *   - Own prefix `commerce/v1`, own route file `routes/api_commerce.php`,
 *     not loaded under the internal `withRouting(api: routes/api.php)`.
 *   - Same base middleware group as `/api/v1`
 *     (`ForceJsonResponse` + `PublicApiRequestContext`) — reused as-is, not
 *     reimplemented: both layers need the identical JSON-forcing +
 *     request-id foundation. `ResolveCommerceLocale` (COM-MOBILE-I18N-1,
 *     ADR-12) is added here too, shared identically with `/store/v1` via
 *     `StorefrontApiServiceProvider` — the one place both surfaces agree on
 *     `Accept-Language` resolution, never a per-route or per-channel copy.
 *   - Own renderable-exception scope, strictly `commerce/v1/*`, reusing
 *     `PublicApiExceptionRenderer` (already engine-agnostic — no `/api/v1`
 *     assumption in its code) so `/commerce/v1` gets the exact same
 *     `PublicApiResponse`/`PublicApiErrorCode` error envelope without
 *     touching `/api/v1`'s or the Internal API's error handling at all.
 */
class CommerceApiServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // COM-MOBILE-AUTH-1 — no real SMS/OTP vendor is integrated yet
        // (explicit product decision: Unifonic is only a future preferred
        // candidate, not committed). `FakeOtpProvider` is the sole binding
        // until a vendor-selection Decision/Owner Gate is resolved; swapping
        // it later touches only this one line.
        $this->app->bind(OtpProvider::class, FakeOtpProvider::class);
    }

    public function boot(): void
    {
        $this->registerCommerceApiRoutes();
        $this->registerCommerceApiExceptionRendering();
    }

    private function registerCommerceApiRoutes(): void
    {
        if ($this->app->routesAreCached()) {
            return;
        }

        Route::middleware([ForceJsonResponse::class, PublicApiRequestContext::class, ResolveCommerceLocale::class])
            ->prefix('commerce/v1')
            ->as('commerce.v1.')
            ->group(base_path('routes/api_commerce.php'));
    }

    private function registerCommerceApiExceptionRendering(): void
    {
        $handler = $this->app->make(ExceptionHandler::class);

        if (! method_exists($handler, 'renderable')) {
            return;
        }

        $handler->renderable(function (Throwable $e, Request $request) {
            if (! $request->is('commerce/v1/*')) {
                return null;
            }

            return PublicApiExceptionRenderer::render($e, $request);
        });
    }
}
