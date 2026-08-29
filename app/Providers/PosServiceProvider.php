<?php

namespace App\Providers;

use App\Http\Controllers\Api\PosShiftController;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsureApplicationActive;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\SetBranch;
use App\Http\Middleware\SetTenant;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * مسارات POS المعيارية التي لا نريد ربطها بأي Domain آخر (مثل HR).
 *
 * يسجّل المزود حالياً CRUD ورديات POS فقط. سلسلة الحماية تطابق مجموعة API
 * الأساسية حرفياً: JSON → Sanctum → tenant/branch → subscription → RBAC → app.
 */
class PosServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Route::prefix('api')
            ->middleware([
                ForceJsonResponse::class,
                'auth:sanctum',
                SetTenant::class,
                SetBranch::class,
                EnsureActiveSubscription::class,
            ])
            ->group(function (): void {
                Route::get('pos-shifts', [PosShiftController::class, 'index'])
                    ->middleware([
                        EnsurePermission::class . ':invoices.manage',
                        EnsureApplicationActive::class . ':sales.pos',
                    ]);

                Route::post('pos-shifts', [PosShiftController::class, 'store'])
                    ->middleware([
                        EnsurePermission::class . ':company.manage',
                        EnsureApplicationActive::class . ':sales.pos',
                    ]);

                Route::put('pos-shifts/{id}', [PosShiftController::class, 'update'])
                    ->middleware([
                        EnsurePermission::class . ':company.manage',
                        EnsureApplicationActive::class . ':sales.pos',
                    ]);

                Route::delete('pos-shifts/{id}', [PosShiftController::class, 'destroy'])
                    ->middleware([
                        EnsurePermission::class . ':company.manage',
                        EnsureApplicationActive::class . ':sales.pos',
                    ]);
            });
    }
}
