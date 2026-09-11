<?php

use App\Http\Controllers\Api\StorefrontCategoryController;
use App\Http\Controllers\Api\StorefrontMediaController;
use App\Http\Controllers\Api\StorefrontProductController;
use App\Http\Middleware\EnforcePublicApiRateLimit;
use App\Http\Middleware\ResolveStorefrontTenant;
use App\Support\PublicApiRateLimits;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Storefront Public Catalog API — v1  (COM-7-P1)
|--------------------------------------------------------------------------
| يُحمَّل هذا الملف عبر App\Providers\StorefrontApiServiceProvider ببادئة
| `store/v1` ومجموعة وسائطه الخاصة (ForceJsonResponse + PublicApiRequestContext).
| مستقل تماماً عن `api/v1` (M2M بمفتاح API) وعن `customer/v1` (عميل مصادَق
| Sanctum) — هذه طبقة **تصفح مجهول** بلا أي مصادقة.
|
| السلسلة الأمنية لكل مسار:
|   {tenantSlug} في الرابط → ResolveStorefrontTenant (يحلّ Tenant.slug النشط
|   ثم SalesChannel النشطة من نوع web، ويضبط TenantContext/StorefrontContext
|   لعمر الطلب فقط — 404 غير كاشف عند أي فشل) → EnforcePublicApiRateLimit:unauth
|   (حماية IP، الفئة المُعدَّة أصلاً لهذا الاستخدام) → استعلام قراءة معزول.
|
| لا `tenant_id`/`X-Tenant-ID` من العميل يُقبل كسلطة في أي طبقة هنا. لا كتابة
| إطلاقاً. نطاق COM-7-P1: كتالوج للقراءة فقط (منتجات، تصنيفات، وسائط) —
| لا سلة، لا Checkout، لا دفع، لا هوية عميل. انظر
| docs/plans/store/AWJ_COM_7_SPREE_INTEGRATION_GATE.md.
*/
Route::prefix('{tenantSlug}')->middleware([
    ResolveStorefrontTenant::class,
    EnforcePublicApiRateLimit::class.':'.PublicApiRateLimits::CLASS_UNAUTH,
])->group(function () {
    Route::get('categories', [StorefrontCategoryController::class, 'index'])->name('categories.index');
    Route::get('categories/{id}', [StorefrontCategoryController::class, 'show'])->whereUuid('id')->name('categories.show');

    Route::get('products', [StorefrontProductController::class, 'index'])->name('products.index');
    Route::get('products/{id}', [StorefrontProductController::class, 'show'])->whereUuid('id')->name('products.show');

    Route::get('media/{id}', [StorefrontMediaController::class, 'show'])->whereUuid('id')->name('media.show');
});
