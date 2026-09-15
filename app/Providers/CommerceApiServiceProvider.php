<?php

namespace App\Providers;

use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestContext;
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
 *     request-id foundation.
 *   - Own renderable-exception scope, strictly `commerce/v1/*`, reusing
 *     `PublicApiExceptionRenderer` (already engine-agnostic — no `/api/v1`
 *     assumption in its code) so `/commerce/v1` gets the exact same
 *     `PublicApiResponse`/`PublicApiErrorCode` error envelope without
 *     touching `/api/v1`'s or the Internal API's error handling at all.
 */
class CommerceApiServiceProvider extends ServiceProvider
{
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

        Route::middleware([ForceJsonResponse::class, PublicApiRequestContext::class])
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
