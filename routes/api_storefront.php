<?php

use App\Http\Controllers\Api\StorefrontCartController;
use App\Http\Controllers\Api\StorefrontCategoryController;
use App\Http\Controllers\Api\StorefrontCheckoutController;
use App\Http\Controllers\Api\StorefrontConfigController;
use App\Http\Controllers\Api\StorefrontMediaController;
use App\Http\Controllers\Api\StorefrontProductController;
use App\Http\Middleware\EnforcePublicApiRateLimit;
use App\Http\Middleware\RequireStorefrontMutationGateway;
use App\Http\Middleware\ResolveStorefrontDomain;
use App\Http\Middleware\ResolveStorefrontTenant;
use App\Support\PublicApiRateLimits;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Storefront Public Catalog API — v1  (COM-7-P1 → COM-7-P2A)
|--------------------------------------------------------------------------
| يُحمَّل هذا الملف عبر App\Providers\StorefrontApiServiceProvider ببادئة
| `store/v1` ومجموعة وسائطه الخاصة (ForceJsonResponse + PublicApiRequestContext).
| مستقل تماماً عن `api/v1` (M2M بمفتاح API) وعن `customer/v1` (عميل مصادَق
| Sanctum) — هذه طبقة **تصفح مجهول** بلا أي مصادقة.
|
| ═══════════════════════════════════════════════════════════════════════
|  المسار الموثوق (COM-7-P2A) — سلطة الإنتاج
| ═══════════════════════════════════════════════════════════════════════
| السلسلة الأمنية لكل مسار: Host الوارد → ResolveStorefrontDomain (يحلّ
| StorefrontDomain النشط والموثَّق ثم Storefront النشط ثم SalesChannel
| النشطة من نوع web التابعة لنفس المستأجر، ويضبط TenantContext/
| StorefrontContext لعمر الطلب فقط — 404 غير كاشف عند أي فشل) →
| EnforcePublicApiRateLimit:unauth (حماية IP) → استعلام قراءة معزول.
| لا `{tenantSlug}` في مسارات هذه المجموعة — الحسم كلّه من الـ Host، لا من
| الرابط. انظر docs/plans/store/AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md.
*/
Route::middleware([
    ResolveStorefrontDomain::class,
    EnforcePublicApiRateLimit::class.':'.PublicApiRateLimits::CLASS_UNAUTH,
])->group(function () {
    Route::get('categories', [StorefrontCategoryController::class, 'index'])->name('categories.index');
    Route::get('categories/{id}', [StorefrontCategoryController::class, 'show'])->whereUuid('id')->name('categories.show');

    Route::get('products', [StorefrontProductController::class, 'index'])->name('products.index');
    Route::get('products/{id}', [StorefrontProductController::class, 'show'])->whereUuid('id')->name('products.show');

    Route::get('media/{id}', [StorefrontMediaController::class, 'show'])->whereUuid('id')->name('media.show');

    Route::get('storefront', [StorefrontConfigController::class, 'show'])->name('storefront.show');

    Route::get('cart', [StorefrontCartController::class, 'show'])->name('cart.show');
    Route::middleware(RequireStorefrontMutationGateway::class)->group(function () {
        Route::post('cart/items', [StorefrontCartController::class, 'store'])->name('cart.items.store');
        Route::patch('cart/items/{item}', [StorefrontCartController::class, 'update'])->whereUuid('item')->name('cart.items.update');
        Route::delete('cart/items/{item}', [StorefrontCartController::class, 'destroy'])->whereUuid('item')->name('cart.items.destroy');
    });

    // COM-CHECKOUT-1A أساسٌ؛ COM-CHECKOUT-1B يضيف /checkout/complete —
    // idempotency إلزامية + التزامٌ صريح، راجع AWJ_CHECKOUT_V1_ARCHITECTURE.md §9.
    Route::get('checkout', [StorefrontCheckoutController::class, 'show'])->name('checkout.show');
    Route::middleware(RequireStorefrontMutationGateway::class)->group(function () {
        Route::post('checkout', [StorefrontCheckoutController::class, 'store'])->name('checkout.store');
        Route::patch('checkout/contact', [StorefrontCheckoutController::class, 'updateContact'])->name('checkout.contact.update');
        Route::patch('checkout/address', [StorefrontCheckoutController::class, 'updateAddress'])->name('checkout.address.update');
        Route::patch('checkout/delivery', [StorefrontCheckoutController::class, 'updateDelivery'])->name('checkout.delivery.update');
        Route::post('checkout/complete', [StorefrontCheckoutController::class, 'complete'])->name('checkout.complete');
    });
});

/*
| ═══════════════════════════════════════════════════════════════════════
|  المسار المتوارَث (COM-7-P1) — تطويري/اختباري محضٌ فقط، ليس سلطة إنتاج
| ═══════════════════════════════════════════════════════════════════════
| **لا يُسجَّل هذا الفرع أصلاً في بيئة `production`** — عزلٌ عند التسجيل، لا
| فقط عند التنفيذ (ResolveStorefrontTenant يرفض العمل دفاعياً أيضاً لو
| استُدعي بأي طريقة أخرى). شكل الرابط `{tenantSlug}/...` لا يتقاطع أبداً مع
| مسارات المجموعة الموثوقة أعلاه (عدد أجزاء الرابط والحرفيّ الثابت مختلفان
| في كل مسار)، فلا لبس بين المجموعتين.
|
| نطاق COM-7-P1 الأصلي كما هو دون تغيير في الدلالة: كتالوج للقراءة فقط
| (منتجات، تصنيفات، وسائط) — لا سلة، لا Checkout، لا دفع، لا هوية عميل. انظر
| docs/plans/store/AWJ_COM_7_SPREE_INTEGRATION_GATE.md.
*/
if (! app()->environment('production')) {
    Route::prefix('{tenantSlug}')->middleware([
        ResolveStorefrontTenant::class,
        EnforcePublicApiRateLimit::class.':'.PublicApiRateLimits::CLASS_UNAUTH,
    ])->group(function () {
        Route::get('categories', [StorefrontCategoryController::class, 'index'])->name('legacy.categories.index');
        Route::get('categories/{id}', [StorefrontCategoryController::class, 'show'])->whereUuid('id')->name('legacy.categories.show');

        Route::get('products', [StorefrontProductController::class, 'index'])->name('legacy.products.index');
        Route::get('products/{id}', [StorefrontProductController::class, 'show'])->whereUuid('id')->name('legacy.products.show');

        Route::get('media/{id}', [StorefrontMediaController::class, 'show'])->whereUuid('id')->name('legacy.media.show');

        Route::get('storefront', [StorefrontConfigController::class, 'show'])->name('legacy.storefront.show');
    });
}
