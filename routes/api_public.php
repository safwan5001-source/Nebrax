<?php

use App\Http\Controllers\Api\PublicHealthController;
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
