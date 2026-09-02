<?php

use App\Http\Controllers\Api\PublicHealthController;
use App\Http\Controllers\Api\PublicInvoiceController;
use App\Http\Controllers\Api\PublicPartnerController;
use App\Http\Controllers\Api\PublicProductController;
use App\Http\Controllers\Api\PublicWebhookController;
use App\Http\Middleware\AuthenticateApiClient;
use App\Http\Middleware\EnforceApiIdempotency;
use App\Http\Middleware\EnforcePlanLimit;
use App\Http\Middleware\EnforcePublicApiRateLimit;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsureApiScope;
use App\Http\Middleware\PublicApiRequestAudit;
use App\Http\Middleware\PublicApiTenantGuard;
use App\Support\PublicApiRateLimits;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public API — v1  (طبقة إضافية مستقلة)
|--------------------------------------------------------------------------
| يُحمَّل هذا الملف عبر App\Providers\PublicApiServiceProvider ببادئة `api/v1`
| ومجموعة وسائطه الخاصة (ForceJsonResponse + PublicApiRequestContext). لا يُحمَّل
| ضمن `withRouting(api: routes/api.php)` الداخلي، ولا يعيد استخدام مجموعات
| الـ Internal API ولا يعدّلها — الفصل تامّ.
|
| المبدأ الحاكم: الـ Public API إضافية. أيّ عملية كتابة مستقبلية تعيد استخدام
| Domain/Application Services في أَوْج (InvoiceService, PartnerService, …) عبر
| المتحكّمات، ولا تصبح هذه الطبقة منطق أعمال موازيًا ولا تكتب في الجداول مباشرة.
|
| قابلية التوسّع (PR-2 فما بعد — لا يُنفَّذ الآن):
|   تحت هذه المجموعة تُضاف مجموعة مستأجر محروسة، فيسجّل أيّ تطبيق في أَوْج موارده
|   وscopes واستحقاقاته دون إعادة بناء المصادقة أو الإصدار أو هذا الأساس:
|
|     Route::middleware([
|         AuthenticateApiKey::class,        // PR-2: يحلّ مفتاح API مملوكًا للمستأجر (M2M)
|         SetTenant::class,                 // يضبط TenantContext من مستأجر المفتاح
|         PublicApiTenantGuard::class,      // fail-closed إن غاب السياق (موجود منذ PR-1)
|         EnsureApiScope::class.':customers:read',
|         EnsureApplicationActive::class.':crm.core',
|     ])->group(fn () => ...);   // موارد التطبيق: v1/customers · v1/products · v1/invoices …
|
|   السلسلة المستهدفة:
|     API Key → Scope → Tenant → Application Entitlement → Business Permission → Domain Service
|
| ⚠️ شرط إلزامي قبل أول مسار بيانات مستأجر في PR-3: اختبار fail-closed صريح يثبت
|    أن PublicApiTenantGuard يرفض الطلب عند غياب TenantContext (موجود منذ PR-1
|    في tests/Feature/PublicApiFoundationTest.php).
*/

// فحص صحّة عام: بلا مصادقة، بلا مستأجر، بلا قاعدة بيانات، بلا كشف بيانات.
// **مستثنى عمدًا** من التدقيق وحدّ المعدّل: مسبار Render يطرقه بتواتر، فحجبه أو
// كتابة صفوف تدقيق له ضجيجٌ بلا قيمة (لا هوية مستأجر، لا بيانات).
Route::get('health', PublicHealthController::class)->name('health');

/*
|--------------------------------------------------------------------------
| موارد المستأجر — قراءة فقط (PR-3)
|--------------------------------------------------------------------------
| السلسلة الأمنية لكل مسار:
|   API Key → ApiClient → TenantContext → PublicApiTenantGuard (fail-closed)
|   → EnsureActiveSubscription (استحقاق: اشتراك نشط، مُعاد استخدامه من الداخلي)
|   → EnsureApiScope (scope تام = نظير صلاحية الأعمال للـ M2M) → استعلام قراءة معزول.
|
| المستأجر يُشتقّ من العميل حصراً؛ لا سياق فرع (نطاق على مستوى المستأجر). لا كتابة.
| كل المعرّفات UUID (whereUuid) فيُرفض المشوّه عند التوجيه (404 مغلّف).
|
| طبقة الحماية (PR-4) — الترتيب مقصود:
|   AuthenticateApiClient → PublicApiTenantGuard → PublicApiRequestAudit
|   → EnforcePublicApiRateLimit:read → EnsureActiveSubscription → EnsureApiScope
| التدقيق **قبل** محدِّد المعدّل ليكتب `handle` مبكرًا فيلتقط `terminate` استجابة
| 429 أيضًا. القراءات GET **لا تخضع لـ idempotency** (طرق آمنة) — تلك بذرة PR-5
| على مسارات الكتابة. حدّ القراءة لكل عميل API (لا IP وحده).
*/
Route::middleware([
    AuthenticateApiClient::class,
    PublicApiTenantGuard::class,
    PublicApiRequestAudit::class,
    EnforcePublicApiRateLimit::class . ':' . PublicApiRateLimits::CLASS_READ,
    EnsureActiveSubscription::class,
])->group(function () {
    Route::middleware(EnsureApiScope::class.':partners:read')->group(function () {
        Route::get('partners', [PublicPartnerController::class, 'index'])->name('partners.index');
        Route::get('partners/{id}', [PublicPartnerController::class, 'show'])->whereUuid('id')->name('partners.show');
    });

    Route::middleware(EnsureApiScope::class.':products:read')->group(function () {
        Route::get('products', [PublicProductController::class, 'index'])->name('products.index');
        Route::get('products/{id}', [PublicProductController::class, 'show'])->whereUuid('id')->name('products.show');
    });

    Route::middleware(EnsureApiScope::class.':invoices:read')->group(function () {
        Route::get('invoices', [PublicInvoiceController::class, 'index'])->name('invoices.index');
        Route::get('invoices/{id}', [PublicInvoiceController::class, 'show'])->whereUuid('id')->name('invoices.show');
    });

    // إدارة اشتراكات الـ Webhooks (PR-7) — قراءة. لا يُكشف السرّ في أيّ قراءة.
    Route::middleware(EnsureApiScope::class.':webhooks:read')->group(function () {
        Route::get('webhooks', [PublicWebhookController::class, 'index'])->name('webhooks.index');
        Route::get('webhooks/{id}', [PublicWebhookController::class, 'show'])->whereUuid('id')->name('webhooks.show');
    });
});

/*
|--------------------------------------------------------------------------
| موارد المستأجر — كتابة محكومة (PR-5)
|--------------------------------------------------------------------------
| إنشاء فقط (POST): طرف · منتج · **مسودّة** فاتورة. تعيد استخدام طبقة الحماية
| (PR-4) وخدمات الدومين القائمة — لا منطق أعمالٍ موازٍ ولا كتابة مباشرة في القيد
| أو المخزون. لا PUT/PATCH/DELETE ولا ترحيل/سداد/إرسال ZATCA.
|
| السلسلة لكل مسار كتابة:
|   AuthenticateApiClient → PublicApiTenantGuard → PublicApiRequestAudit
|   → EnforcePublicApiRateLimit:**write** → EnsureActiveSubscription
|   → EnsureApiScope:{x}:write → EnforceApiIdempotency (Idempotency-Key إلزامي)
|   → المتحكّم → خدمة الدومين → مورد Public مُنتقى.
| فئة الحدّ **write** (أثقل من القراءة)، وحارس idempotency على مستوى المسار بعد
| الـ scope فلا يُنشئ طلبٌ غير مخوَّل سجلّ idempotency. الفاتورة تضيف حدّ الخطة.
*/
Route::middleware([
    AuthenticateApiClient::class,
    PublicApiTenantGuard::class,
    PublicApiRequestAudit::class,
    EnforcePublicApiRateLimit::class . ':' . PublicApiRateLimits::CLASS_WRITE,
    EnsureActiveSubscription::class,
])->group(function () {
    Route::middleware([EnsureApiScope::class.':partners:write', EnforceApiIdempotency::class])
        ->post('partners', [PublicPartnerController::class, 'store'])->name('partners.store');

    Route::middleware([EnsureApiScope::class.':products:write', EnforceApiIdempotency::class])
        ->post('products', [PublicProductController::class, 'store'])->name('products.store');

    // idempotency **قبل** حدّ الخطة: إعادةُ طلبٍ استهلك الحصّة الأخيرة يجب أن تُعيد
    // تشغيل الـ201 المخزَّنة، لا أن يرفضها حدُّ الخطة (العدّاد بلغ الحدّ). الطلب
    // الجديد (مفتاح جديد) يبلغ حدَّ الخطة بعد المطالبة فيُرفض 422 — الحدّ محفوظ.
    Route::middleware([EnsureApiScope::class.':invoices:write', EnforceApiIdempotency::class, EnforcePlanLimit::class.':invoices'])
        ->post('invoices', [PublicInvoiceController::class, 'store'])->name('invoices.store');

    // إدارة اشتراكات الـ Webhooks (PR-7) — كتابة. الإنشاء والتدوير (POST) بمفتاح
    // idempotency إلزاميّ (لا إنشاء/تدوير مزدوج عند إعادة المحاولة). PATCH/DELETE
    // متغيّرا حالةٍ طبيعيّا الجَمْعِيّة فلا يحملان الحارس. السرّ يُعرَض مرّة واحدة.
    Route::middleware(EnsureApiScope::class.':webhooks:write')->group(function () {
        Route::post('webhooks', [PublicWebhookController::class, 'store'])
            ->middleware(EnforceApiIdempotency::class)->name('webhooks.store');
        Route::patch('webhooks/{id}', [PublicWebhookController::class, 'update'])
            ->whereUuid('id')->name('webhooks.update');
        Route::delete('webhooks/{id}', [PublicWebhookController::class, 'destroy'])
            ->whereUuid('id')->name('webhooks.destroy');
        Route::post('webhooks/{id}/rotate-secret', [PublicWebhookController::class, 'rotateSecret'])
            ->whereUuid('id')->middleware(EnforceApiIdempotency::class)->name('webhooks.rotate-secret');
    });
});
