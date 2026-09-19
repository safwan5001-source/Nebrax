<?php

namespace App\Providers;

use App\Http\Controllers\Api\CommerceCategoryPublicationController;
use App\Http\Controllers\Api\CommerceProductPublicationController;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\EnsureUserPrincipal;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\IdentifyTenantHostname;
use App\Http\Middleware\SetBranch;
use App\Http\Middleware\SetTenant;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/** Small isolated route surface for Commerce Workspace admin operations. */
final class CommerceWorkspaceServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        if ($this->app->routesAreCached()) {
            return;
        }

        Route::middleware([
            ForceJsonResponse::class,
            IdentifyTenantHostname::class,
            'auth:sanctum',
            EnsureUserPrincipal::class,
            SetTenant::class,
            SetBranch::class,
            EnsureActiveSubscription::class,
        ])->prefix('api/commerce/workspace/products')->group(function (): void {
            // COM-CATALOG-1 — Product Publication Workspace list. Registered
            // before {id} so the literal segment can never be shadowed.
            Route::get('publication', [CommerceProductPublicationController::class, 'index'])
                ->middleware(EnsurePermission::class.':products.view');
            Route::get('{id}/publication', [CommerceProductPublicationController::class, 'show'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/publication', [CommerceProductPublicationController::class, 'update'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
        });

        Route::middleware([
            ForceJsonResponse::class,
            IdentifyTenantHostname::class,
            'auth:sanctum',
            EnsureUserPrincipal::class,
            SetTenant::class,
            SetBranch::class,
            EnsureActiveSubscription::class,
        ])->prefix('api/commerce/workspace/categories')->group(function (): void {
            // COM-CATALOG-2 — Category Publication Workspace. Registered before
            // {id} so the literal segment can never be shadowed. RBAC mirrors
            // COM-CATALOG-1 exactly: products.view to read, products.manage to
            // write — no new permission.
            Route::get('publication', [CommerceCategoryPublicationController::class, 'index'])
                ->middleware(EnsurePermission::class.':products.view');
            Route::get('{id}/publication', [CommerceCategoryPublicationController::class, 'show'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/publication', [CommerceCategoryPublicationController::class, 'update'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
        });
    }
}
