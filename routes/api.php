<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CompanyController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\PartnerController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\PayrollController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\QuoteController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ReturnController;
use App\Http\Controllers\Api\SalesSettingsController;
use App\Http\Controllers\Api\SubscriptionController;
use App\Http\Controllers\Api\UserController;
use App\Http\Middleware\EnforcePlanLimit;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\SetTenant;
use Illuminate\Support\Facades\Route;

// كل مسارات الـ API ترجع JSON موحّداً (بما فيها الأخطاء).
Route::middleware(ForceJsonResponse::class)->group(function () {

    // عام (بلا مصادقة)
    Route::post('register', [AuthController::class, 'register']);
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:5,1');

    // محمي: مصادقة Sanctum + ضبط المستأجر (العزل التلقائي)
    Route::middleware(['auth:sanctum', SetTenant::class])->group(function () {
        // متاح دائماً (حتى مع اشتراك منتهٍ) لرؤية الحالة والخروج
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::get('subscription', [SubscriptionController::class, 'show']); // متاح حتى مع اشتراك منتهٍ

        $perm = fn (string $p) => EnsurePermission::class . ':' . $p;

        // الموارد تتطلب اشتراكاً نشطاً
        Route::middleware(EnsureActiveSubscription::class)->group(function () use ($perm) {

        // الأطراف
        Route::get('partners', [PartnerController::class, 'index'])->middleware($perm('partners.view'));
        Route::get('partners/{id}', [PartnerController::class, 'show'])->middleware($perm('partners.view'));
        Route::post('partners', [PartnerController::class, 'store'])->middleware($perm('partners.manage'));
        Route::put('partners/{id}', [PartnerController::class, 'update'])->middleware($perm('partners.manage'));
        Route::delete('partners/{id}', [PartnerController::class, 'destroy'])->middleware($perm('partners.manage'));

        // المنتجات
        Route::get('products', [ProductController::class, 'index'])->middleware($perm('products.view'));
        Route::get('products/{id}', [ProductController::class, 'show'])->middleware($perm('products.view'));
        Route::post('products', [ProductController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('products/{id}', [ProductController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('products/{id}', [ProductController::class, 'destroy'])->middleware($perm('products.manage'));

        // تقرير المخزون (قراءة فقط — لا أثر محاسبي)
        Route::get('inventory', [InventoryController::class, 'index'])->middleware($perm('products.view'));
        Route::get('inventory/{productId}/movements', [InventoryController::class, 'movements'])->middleware($perm('products.view'));

        // دليل الحسابات (قراءة)
        Route::get('accounts', [AccountController::class, 'index'])->middleware($perm('accounts.view'));
        Route::get('accounts/{id}', [AccountController::class, 'show'])->middleware($perm('accounts.view'));

        // الفواتير
        Route::get('invoices', [InvoiceController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}', [InvoiceController::class, 'show'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}/zatca', [InvoiceController::class, 'zatca'])->middleware($perm('zatca.view'));
        Route::post('invoices', [InvoiceController::class, 'store'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);
        Route::post('invoices/{id}/post', [InvoiceController::class, 'post'])->middleware($perm('invoices.manage'));

        // عروض الأسعار (مستند غير محاسبي؛ التحويل ينشئ فاتورة draft)
        Route::get('quotes', [QuoteController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('quotes/{id}', [QuoteController::class, 'show'])->middleware($perm('invoices.view'));
        Route::post('quotes', [QuoteController::class, 'store'])->middleware($perm('invoices.manage'));
        Route::put('quotes/{id}', [QuoteController::class, 'update'])->middleware($perm('invoices.manage'));
        Route::delete('quotes/{id}', [QuoteController::class, 'destroy'])->middleware($perm('invoices.manage'));
        Route::post('quotes/{id}/convert', [QuoteController::class, 'convert'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);

        // المدفوعات
        Route::get('payments', [PaymentController::class, 'index'])->middleware($perm('payments.view'));
        Route::get('payments/{id}', [PaymentController::class, 'show'])->middleware($perm('payments.view'));
        Route::post('payments', [PaymentController::class, 'store'])->middleware($perm('payments.manage'));
        Route::post('payments/{id}/post', [PaymentController::class, 'post'])->middleware($perm('payments.manage'));

        // المشتريات
        Route::get('purchases', [PurchaseController::class, 'index'])->middleware($perm('purchases.view'));
        Route::get('purchases/{id}', [PurchaseController::class, 'show'])->middleware($perm('purchases.view'));
        Route::post('purchases', [PurchaseController::class, 'store'])->middleware($perm('purchases.manage'));
        Route::post('purchases/{id}/post', [PurchaseController::class, 'post'])->middleware($perm('purchases.manage'));

        // المرتجعات
        Route::get('returns', [ReturnController::class, 'index'])->middleware($perm('returns.view'));
        Route::get('returns/{id}', [ReturnController::class, 'show'])->middleware($perm('returns.view'));
        Route::post('returns', [ReturnController::class, 'store'])->middleware($perm('returns.manage'));
        Route::post('returns/{id}/post', [ReturnController::class, 'post'])->middleware($perm('returns.manage'));

        // الموظفون (HR)
        Route::get('employees', [EmployeeController::class, 'index'])->middleware($perm('hr.view'));
        Route::get('employees/{id}', [EmployeeController::class, 'show'])->middleware($perm('hr.view'));
        Route::post('employees', [EmployeeController::class, 'store'])->middleware($perm('hr.manage'));
        Route::put('employees/{id}', [EmployeeController::class, 'update'])->middleware($perm('hr.manage'));
        Route::delete('employees/{id}', [EmployeeController::class, 'destroy'])->middleware($perm('hr.manage'));

        // مسيّرات الرواتب
        Route::get('payroll-runs', [PayrollController::class, 'index'])->middleware($perm('hr.view'));
        Route::get('payroll-runs/{id}', [PayrollController::class, 'show'])->middleware($perm('hr.view'));
        Route::post('payroll-runs', [PayrollController::class, 'store'])->middleware($perm('hr.manage'));
        Route::post('payroll-runs/{id}/post', [PayrollController::class, 'post'])->middleware($perm('hr.manage'));
        Route::post('payroll-runs/{id}/pay', [PayrollController::class, 'pay'])->middleware($perm('hr.manage'));

        // إعدادات الشركة (owner/admin) — تحديث ملف فقط، لا أثر محاسبي
        Route::put('company', [CompanyController::class, 'update'])->middleware($perm('company.manage'));

        // إعدادات المبيعات (تفضيلات غير محاسبية)
        Route::get('sales-settings', [SalesSettingsController::class, 'show'])->middleware($perm('invoices.view'));
        Route::put('sales-settings', [SalesSettingsController::class, 'update'])->middleware($perm('company.manage'));

        // إدارة المستخدمين (owner/admin)
        Route::get('users', [UserController::class, 'index'])->middleware($perm('users.view'));
        Route::post('users', [UserController::class, 'store'])->middleware($perm('users.manage'));
        Route::put('users/{id}', [UserController::class, 'update'])->middleware($perm('users.manage'));
        Route::delete('users/{id}', [UserController::class, 'destroy'])->middleware($perm('users.manage'));

        // التقارير
        Route::get('reports/trial-balance', [ReportController::class, 'trialBalance'])->middleware($perm('reports.view'));
        Route::get('reports/income-statement', [ReportController::class, 'incomeStatement'])->middleware($perm('reports.view'));
        Route::get('reports/balance-sheet', [ReportController::class, 'balanceSheet'])->middleware($perm('reports.view'));
        Route::get('reports/account-ledger/{accountId}', [ReportController::class, 'accountLedger'])->middleware($perm('reports.view'));
        Route::get('reports/partner-statement/{partnerId}', [ReportController::class, 'partnerStatement'])->middleware($perm('reports.view'));
        Route::get('reports/aging/{type}', [ReportController::class, 'aging'])->middleware($perm('reports.view'));

        }); // نهاية مجموعة الاشتراك النشط
    });
});
