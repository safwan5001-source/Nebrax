<?php

namespace App\Providers;

use App\Http\Controllers\Api\InventoryController;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsureApplicationActive;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\EnsureUserPrincipal;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\SetBranch;
use App\Http\Middleware\SetTenant;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class InventoryWorkspaceServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Route::prefix('api')
            ->middleware([
                ForceJsonResponse::class,
                'auth:sanctum',
                EnsureUserPrincipal::class,
                SetTenant::class,
                SetBranch::class,
                EnsureActiveSubscription::class,
            ])
            ->group(function (): void {
                Route::get('inventory/workspace', [InventoryController::class, 'workspace'])
                    ->middleware([
                        EnsurePermission::class.':products.view',
                        EnsureApplicationActive::class.':inventory.core',
                    ]);
            });
    }
}
