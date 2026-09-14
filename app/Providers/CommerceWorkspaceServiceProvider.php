<?php

namespace App\Providers;

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
            Route::get('{id}/publication', [CommerceProductPublicationController::class, 'show'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/publication', [CommerceProductPublicationController::class, 'update'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
        });
    }
}
