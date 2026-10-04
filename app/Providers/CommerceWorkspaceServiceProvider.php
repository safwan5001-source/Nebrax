<?php

namespace App\Providers;

use App\Http\Controllers\Api\CommerceCategoryPublicationController;
use App\Http\Controllers\Api\CommerceCollectionController;
use App\Http\Controllers\Api\CommerceFacetController;
use App\Http\Controllers\Api\CommercePersonalizationController;
use App\Http\Controllers\Api\CommerceProductAddonController;
use App\Http\Controllers\Api\CommerceProductContentController;
use App\Http\Controllers\Api\CommerceProductPreparationController;
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

            // FLOWERS-H2 / ADR-14 — إسناد قيم الأبعاد الوصفية لمنتج. RBAC يطابق النشر.
            Route::get('{id}/facets', [CommerceFacetController::class, 'productAssignments'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/facets', [CommerceFacetController::class, 'replaceProductAssignments'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
            // FLOWERS-H4a / ADR-16 — تعريفات التخصيص لكل منتج. RBAC يطابق النشر.
            Route::get('{id}/personalization', [CommercePersonalizationController::class, 'show'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/personalization', [CommercePersonalizationController::class, 'replace'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');

            // FLOWERS-H6 / ADR-18 — الإضافات الاختيارية لكل منتج. RBAC يطابق النشر.
            Route::get('{id}/addons', [CommerceProductAddonController::class, 'show'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/addons', [CommerceProductAddonController::class, 'replace'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');

            // FLOWERS-H8 / ADR-20 — مهلة تجهيز المنتج (مدخل وعد التسليم). RBAC يطابق النشر.
            Route::get('{id}/preparation', [CommerceProductPreparationController::class, 'show'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/preparation', [CommerceProductPreparationController::class, 'replace'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');

            // FLOWERS-H5 / ADR-17 — كتل المحتوى المهيكلة لكل منتج. RBAC يطابق النشر.
            Route::get('{id}/content', [CommerceProductContentController::class, 'show'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/content', [CommerceProductContentController::class, 'replace'])
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

        Route::middleware([
            ForceJsonResponse::class,
            IdentifyTenantHostname::class,
            'auth:sanctum',
            EnsureUserPrincipal::class,
            SetTenant::class,
            SetBranch::class,
            EnsureActiveSubscription::class,
        ])->prefix('api/commerce/workspace/facets')->group(function (): void {
            // FLOWERS-H2 / ADR-14 — الأبعاد الوصفية وقيمها. products.view للقراءة
            // وproducts.manage للكتابة — بلا صلاحية جديدة (نمط COM-CATALOG-1/2).
            Route::get('/', [CommerceFacetController::class, 'index'])
                ->middleware(EnsurePermission::class.':products.view');
            Route::post('/', [CommerceFacetController::class, 'store'])
                ->middleware(EnsurePermission::class.':products.manage');
            Route::put('{id}', [CommerceFacetController::class, 'update'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
            Route::delete('{id}', [CommerceFacetController::class, 'destroy'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
            Route::post('{id}/values', [CommerceFacetController::class, 'storeValue'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
            Route::put('{id}/values/{valueId}', [CommerceFacetController::class, 'updateValue'])
                ->whereUuid(['id', 'valueId'])
                ->middleware(EnsurePermission::class.':products.manage');
            Route::delete('{id}/values/{valueId}', [CommerceFacetController::class, 'destroyValue'])
                ->whereUuid(['id', 'valueId'])
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
        ])->prefix('api/commerce/workspace/collections')->group(function (): void {
            // FLOWERS-H2 / ADR-14 §2.3 — المجموعات التسويقية اليدوية وعضويتها المرتّبة.
            Route::get('/', [CommerceCollectionController::class, 'index'])
                ->middleware(EnsurePermission::class.':products.view');
            Route::post('/', [CommerceCollectionController::class, 'store'])
                ->middleware(EnsurePermission::class.':products.manage');
            Route::put('{id}', [CommerceCollectionController::class, 'update'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
            Route::delete('{id}', [CommerceCollectionController::class, 'destroy'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
            Route::get('{id}/products', [CommerceCollectionController::class, 'members'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.view');
            Route::put('{id}/products', [CommerceCollectionController::class, 'replaceMembers'])
                ->whereUuid('id')
                ->middleware(EnsurePermission::class.':products.manage');
        });
    }
}
