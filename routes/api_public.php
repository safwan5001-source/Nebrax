<?php

use App\Http\Controllers\Api\PublicHealthController;
use App\Http\Controllers\Api\PublicInvoiceController;
use App\Http\Controllers\Api\PublicPartnerController;
use App\Http\Controllers\Api\PublicProductController;
use App\Http\Middleware\AuthenticateApiClient;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsureApiScope;
use App\Http\Middleware\PublicApiTenantGuard;
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
*/
Route::middleware([
    AuthenticateApiClient::class,
    PublicApiTenantGuard::class,
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
});
