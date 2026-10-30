<?php

use App\Http\Controllers\Api\StorefrontBuyerAuthController;
use App\Http\Controllers\Api\StorefrontCartController;
use App\Http\Controllers\Api\StorefrontCategoryController;
use App\Http\Controllers\Api\StorefrontCollectionController;
use App\Http\Controllers\Api\StorefrontCheckoutController;
use App\Http\Controllers\Api\StorefrontOnlinePaymentController;
use App\Http\Controllers\Api\StorefrontConfigController;
use App\Http\Controllers\Api\StorefrontDeliveryScheduleController;
use App\Http\Controllers\Api\StorefrontCustomizerMediaController;
use App\Http\Controllers\Api\StorefrontFacetVisualMediaController;
use App\Http\Controllers\Api\StorefrontMediaController;
use App\Http\Controllers\Api\StorefrontOfferController;
use App\Http\Controllers\Api\StorefrontPolicyController;
use App\Http\Controllers\Api\StorefrontProductController;
use App\Http\Controllers\Api\StorefrontWholesaleController;
use App\Http\Middleware\AuthenticateCommerceCustomer;
use App\Http\Middleware\BindStorefrontBuyerToChannel;
use App\Http\Middleware\EnsureApprovedWholesaleBuyer;
use App\Http\Middleware\EnsureWholesaleBuyerEnabled;
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

    // FLOWERS-H2 / ADR-14 §2.3 — مجموعات تسويقية يدوية (قراءة فقط).
    Route::get('collections', [StorefrontCollectionController::class, 'index'])->name('collections.index');

    // FLOWERS-H7a / ADR-19 — خيارات جدولة التسليم المتاحة فعلاً (قراءة فقط).
    Route::get('delivery-schedule', [StorefrontDeliveryScheduleController::class, 'show'])->name('delivery_schedule.show');

    Route::get('products', [StorefrontProductController::class, 'index'])->name('products.index');
    Route::get('products/{id}', [StorefrontProductController::class, 'show'])->whereUuid('id')->name('products.show');

    // CUST-HV V2c — وسائط المُخصِّص (بوابة المرجع المنشور؛ الأصل `private, no-store`).
    // مقطعان ثابتان بعد `media/customizer` فلا يتقاطع مع `media/{id}/derivatives/{x}`.
    Route::get('media/customizer/{id}/{file}', [StorefrontCustomizerMediaController::class, 'show'])
        ->where('id', '[0-9a-fA-F-]{32,36}')->where('file', '[A-Za-z0-9._-]{1,40}')->name('media.customizer.show');

    // AWJ-VD-H1 / VD-1c — صور الأبعاد وقيمها (§3.8-c): المضيف وحده لأن الرؤية على القناة تحتاج سياق المتجر (D2).
    // القيود متساهلة عمداً: التحقق كله داخل المتحكّم، فكل إخفاق 404 موحّد بـ`no-store` (D4)، وأي شكلٍ آخر تحت
    // البادئة يصل إلى `missing` بالرد نفسه بدل 404 الإطار.
    Route::get('media/facet-visuals/{visualId}/{mediaId}/{file}', [StorefrontFacetVisualMediaController::class, 'show'])
        ->where(['visualId' => '[^/]+', 'mediaId' => '[^/]+', 'file' => '[^/]+'])->name('media.facet_visual.show');
    Route::get('media/facet-visuals/{rest?}', [StorefrontFacetVisualMediaController::class, 'missing'])
        ->where('rest', '.*')->name('media.facet_visual.missing');

    Route::get('media/categories/{id}', [StorefrontMediaController::class, 'showCategory'])->whereUuid('id')->name('media.category.show');
    Route::get('media/{id}/derivatives/{derivative}', [StorefrontMediaController::class, 'showDerivative'])
        ->whereUuid('id')->whereIn('derivative', ['thumbnail', 'card'])->name('media.derivative.show');
    Route::get('media/{id}', [StorefrontMediaController::class, 'show'])->whereUuid('id')->name('media.show');

    Route::get('storefront', [StorefrontConfigController::class, 'show'])->name('storefront.show');

    // B8-2 — نص سياسة منشور (HTML منقّى) بمضيف الطلب وحده؛ كل slug غير مسموح 404 موحَّد من المتحكّم.
    Route::get('policies/{slug}', [StorefrontPolicyController::class, 'show'])
        ->where('slug', '[^/]+')->name('policies.show');

    // CUST-H4-6 — العروض الحيّة (خصمٌ حقيقي من CommercePriceResolver). مسار Host
    // فقط: لا معرّف متجر في الرابط ولا يُقبل من أي مدخل، وليس له نظير متوارَث.
    Route::get('offers', [StorefrontOfferController::class, 'index'])->name('offers.index');

    Route::get('cart', [StorefrontCartController::class, 'show'])->name('cart.show');
    Route::middleware(RequireStorefrontMutationGateway::class)->group(function () {
        Route::post('cart/items', [StorefrontCartController::class, 'store'])->name('cart.items.store');
        Route::patch('cart/items/{item}', [StorefrontCartController::class, 'update'])->whereUuid('item')->name('cart.items.update');
        Route::delete('cart/items/{item}', [StorefrontCartController::class, 'destroy'])->whereUuid('item')->name('cart.items.destroy');
    });

    // H6 Batch E — هوية مشتري الجملة وعضويته (بريد + كلمة مرور؛ OTP لاحقاً عبر Messaging Foundation).
    // مغلق افتراضياً: بوابة النشر `commerce.wholesale_buyer_enabled` **و** قناة الـ Host موسومة
    // `wholesale_membership_enabled` وإلا 404 موحَّد (لا أثر على أي متجر DTC). الكتابة خلف بوابة الخادم.
    // الجلسة: `X-Customer-Token` مربوط بقناة هذا الـ Host (`store-channel:{id}`) فلا يُعاد استعماله عبر مضيف/قناة.
    // العضوية حالة أهلية مستقلة عن المصادقة؛ `wholesale/access` نموذج بوابة القدرات المحمية القادمة.
    Route::middleware(EnsureWholesaleBuyerEnabled::class)->group(function () {
        Route::middleware(RequireStorefrontMutationGateway::class)->group(function () {
            Route::post('auth/register', [StorefrontBuyerAuthController::class, 'register'])
                ->middleware('throttle:storefront-buyer-register')->name('buyer.register');
            Route::post('auth/login', [StorefrontBuyerAuthController::class, 'login'])
                ->middleware('throttle:storefront-buyer-login')->name('buyer.login');
        });

        Route::middleware([AuthenticateCommerceCustomer::class, BindStorefrontBuyerToChannel::class])->group(function () {
            Route::get('me', [StorefrontBuyerAuthController::class, 'me'])->name('buyer.me');
            Route::get('wholesale/membership', [StorefrontWholesaleController::class, 'membership'])->name('wholesale.membership.show');
            Route::middleware(RequireStorefrontMutationGateway::class)->group(function () {
                Route::post('auth/logout', [StorefrontBuyerAuthController::class, 'logout'])->name('buyer.logout');
                Route::post('wholesale/application', [StorefrontWholesaleController::class, 'apply'])
                    ->middleware('throttle:storefront-buyer-apply')->name('wholesale.application.store');
            });
            Route::get('wholesale/access', [StorefrontWholesaleController::class, 'access'])
                ->middleware(EnsureApprovedWholesaleBuyer::class)->name('wholesale.access');
        });
    });

    // COM-CHECKOUT-1A أساسٌ؛ COM-CHECKOUT-1B يضيف /checkout/complete —
    // idempotency إلزامية + التزامٌ صريح، راجع AWJ_CHECKOUT_V1_ARCHITECTURE.md §9.
    Route::get('checkout', [StorefrontCheckoutController::class, 'show'])->name('checkout.show');
    // COM-MOBILE-PAYMENTS-1 — طرق الدفع المتاحة فعلياً للقناة الحالية
    // (ADR-09 §3)، عبر PaymentMethodChannelAvailabilityService. قراءة فقط.
    Route::get('checkout/payment-methods', [StorefrontCheckoutController::class, 'paymentMethods'])->name('checkout.payment_methods.index');
    // PAY-H4-04a — حالة الدفع الإلكتروني لطلب (حقيقة الخادم، لا عودة المتصفح). الملكية بمرجع الطلب الموقَّع؛ مغلق (404) خلف البوابة المنصّية.
    Route::get('orders/{order}/payment-status', [StorefrontOnlinePaymentController::class, 'status'])
        ->whereUuid('order')->middleware('throttle:30,1')->name('orders.payment_status');
    Route::middleware(RequireStorefrontMutationGateway::class)->group(function () {
        // PAY-H4-04a — بدء/استئناف محاولة دفع إلكتروني للطلب (يعيد `checkout_url` لصفحة المزوّد المستضافة).
        Route::post('checkout/payment-intent', [StorefrontOnlinePaymentController::class, 'start'])
            ->middleware('throttle:10,1')->name('checkout.payment_intent.store');
        Route::post('checkout', [StorefrontCheckoutController::class, 'store'])->name('checkout.store');
        Route::patch('checkout/contact', [StorefrontCheckoutController::class, 'updateContact'])->name('checkout.contact.update');
        Route::patch('checkout/address', [StorefrontCheckoutController::class, 'updateAddress'])->name('checkout.address.update');
        // FLOWERS-H3 / ADR-15 — هوية الإهداء ورسالته.
        Route::patch('checkout/gift', [StorefrontCheckoutController::class, 'updateGift'])->name('checkout.gift.update');
        // FLOWERS-H7b / ADR-19 — موعد التسليم (تاريخ + نافذة).
        Route::patch('checkout/schedule', [StorefrontCheckoutController::class, 'updateSchedule'])->name('checkout.schedule.update');
        Route::patch('checkout/delivery', [StorefrontCheckoutController::class, 'updateDelivery'])->name('checkout.delivery.update');
        Route::patch('checkout/payment', [StorefrontCheckoutController::class, 'updatePayment'])->name('checkout.payment.update');
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

        Route::get('collections', [StorefrontCollectionController::class, 'index'])->name('legacy.collections.index');
        Route::get('delivery-schedule', [StorefrontDeliveryScheduleController::class, 'show'])->name('legacy.delivery_schedule.show');

        Route::get('products', [StorefrontProductController::class, 'index'])->name('legacy.products.index');
        Route::get('products/{id}', [StorefrontProductController::class, 'show'])->whereUuid('id')->name('legacy.products.show');

        Route::get('media/categories/{id}', [StorefrontMediaController::class, 'showCategory'])->whereUuid('id')->name('legacy.media.category.show');
        Route::get('media/{id}/derivatives/{derivative}', [StorefrontMediaController::class, 'showDerivative'])
            ->whereUuid('id')->whereIn('derivative', ['thumbnail', 'card'])->name('legacy.media.derivative.show');
        Route::get('media/{id}', [StorefrontMediaController::class, 'show'])->whereUuid('id')->name('legacy.media.show');

        Route::get('storefront', [StorefrontConfigController::class, 'show'])->name('legacy.storefront.show');
    });
}
