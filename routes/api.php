<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\AssetController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\BrandController;
use App\Http\Controllers\Api\BranchSettingsController;
use App\Http\Controllers\Api\CashBankAccountController;
use App\Http\Controllers\Api\CompanyController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\CostCenterController;
use App\Http\Controllers\Api\CreditNoteController;
use App\Http\Controllers\Api\CrmActivityController;
use App\Http\Controllers\Api\CustomerReportController;
use App\Http\Controllers\Api\CustomerSettingsController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DocumentRevisionController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\EmployeeCustodyController;
use App\Http\Controllers\Api\ExpenseCategoryController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\FinanceSettingsController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\InventoryReportController;
use App\Http\Controllers\Api\InventorySettingsController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\PartnerController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\PayrollController;
use App\Http\Controllers\Api\ProductCategoryController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\PosController;
use App\Http\Controllers\Api\PosSessionController;
use App\Http\Controllers\Api\PrintTemplateController;
use App\Http\Controllers\Api\ProcurementController;
use App\Http\Controllers\Api\PurchaseSettingsController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\PurchaseReportController;
use App\Http\Controllers\Api\QuoteController;
use App\Http\Controllers\Api\RecurringInvoiceController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ReturnController;
use App\Http\Controllers\Api\ReturnableController;
use App\Http\Controllers\Api\ReturnSourcesController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SalesConfigController;
use App\Http\Controllers\Api\SalesReportController;
use App\Http\Controllers\Api\SalesSettingsController;
use App\Http\Controllers\Api\SettlementTypeController;
use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Api\StockPermitController;
use App\Http\Controllers\Api\StocktakeController;
use App\Http\Controllers\Api\SubscriptionController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\UnitTemplateController;
use App\Http\Controllers\Api\NumberingSettingsController;
use App\Http\Controllers\Api\WarehouseController;
use App\Http\Controllers\Api\ZatcaSettingsController;
use App\Http\Middleware\EnforcePlanLimit;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\SetBranch;
use App\Http\Middleware\SetTenant;
use Illuminate\Support\Facades\Route;

/**
 * ═══════════════════════════════════════════════════════════════
 *  المعرّفات في المسارات **يجب أن تكون UUID** — وإلا لم يُطابَق المسار
 * ═══════════════════════════════════════════════════════════════
 *  كل مفاتيح النماذج من نوع `uuid` في PostgreSQL، وهو يرفض أي نصّ غير صالح
 *  بـ `SQLSTATE[22P02]` — فيتحوّل معرّفٌ مشوّه إلى **500 خطأ خادم** بدل 404.
 *  (SQLite لا يتحقّق من النوع فيمرّ صامتاً، ولذلك لم يظهر في الاختبارات.)
 *
 *  القيد هنا يجعل المسار **لا يُطابَق أصلاً** فتُعاد 404 — وهي الدلالة
 *  الصحيحة لمعرّف غير موجود، وتُغلق باباً لتعطيل الخدمة بمعرّف عشوائي.
 *
 *  `{type}` و`{section}` مستثناة عمداً: نصّية لا معرّفات.
 */
$uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
Route::pattern('id', $uuid);
Route::pattern('productId', $uuid);
Route::pattern('partnerId', $uuid);
Route::pattern('accountId', $uuid);

// كل مسارات الـ API ترجع JSON موحّداً (بما فيها الأخطاء).
Route::middleware(ForceJsonResponse::class)->group(function () {

    // فحص صحّة للنشر (بلا مصادقة) — تستخدمه منصّة الاستضافة
    Route::get('health', HealthController::class);

    // عام (بلا مصادقة)
    Route::post('register', [AuthController::class, 'register'])->middleware('throttle:register');
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:5,1');

    // محمي: مصادقة Sanctum + ضبط المستأجر (العزل التلقائي)
    Route::middleware(['auth:sanctum', SetTenant::class, SetBranch::class])->group(function () {
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
        // مواعيد العملاء (غير محاسبية)
        Route::get('appointments', [AppointmentController::class, 'index'])->middleware($perm('partners.view'));
        Route::get('invoices/{id}/appointments', [AppointmentController::class, 'forInvoice'])->middleware($perm('partners.view'));
        Route::get('appointments/{id}', [AppointmentController::class, 'show'])->middleware($perm('partners.view'));
        Route::post('appointments', [AppointmentController::class, 'store'])->middleware($perm('partners.manage'));
        Route::put('appointments/{id}', [AppointmentController::class, 'update'])->middleware($perm('partners.manage'));
        Route::delete('appointments/{id}', [AppointmentController::class, 'destroy'])->middleware($perm('partners.manage'));

        // جهات الاتصال (غير محاسبية)
        Route::get('contacts', [ContactController::class, 'index'])->middleware($perm('partners.view'));
        Route::get('contacts/{id}', [ContactController::class, 'show'])->middleware($perm('partners.view'));
        Route::post('contacts', [ContactController::class, 'store'])->middleware($perm('partners.manage'));
        Route::put('contacts/{id}', [ContactController::class, 'update'])->middleware($perm('partners.manage'));
        Route::delete('contacts/{id}', [ContactController::class, 'destroy'])->middleware($perm('partners.manage'));

        // سجلّ علاقات العملاء (CRM) — غير محاسبي
        Route::get('crm-activities', [CrmActivityController::class, 'index'])->middleware($perm('partners.view'));
        Route::get('crm-activities/{id}', [CrmActivityController::class, 'show'])->middleware($perm('partners.view'));
        Route::post('crm-activities', [CrmActivityController::class, 'store'])->middleware($perm('partners.manage'));
        Route::put('crm-activities/{id}', [CrmActivityController::class, 'update'])->middleware($perm('partners.manage'));
        Route::delete('crm-activities/{id}', [CrmActivityController::class, 'destroy'])->middleware($perm('partners.manage'));

        Route::delete('partners/{id}', [PartnerController::class, 'destroy'])->middleware($perm('partners.manage'));

        // المنتجات
        Route::get('products', [ProductController::class, 'index'])->middleware($perm('products.view'));
        Route::get('products/{id}', [ProductController::class, 'show'])->middleware($perm('products.view'));
        Route::post('products', [ProductController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('products/{id}', [ProductController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('products/{id}', [ProductController::class, 'destroy'])->middleware($perm('products.manage'));

        // تصنيفات المنتجات والعلامات التجارية (قوائم تصنيف — لا أثر محاسبي)
        Route::get('product-categories', [ProductCategoryController::class, 'index'])->middleware($perm('products.view'));
        Route::post('product-categories', [ProductCategoryController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('product-categories/{id}', [ProductCategoryController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('product-categories/{id}', [ProductCategoryController::class, 'destroy'])->middleware($perm('products.manage'));

        Route::get('brands', [BrandController::class, 'index'])->middleware($perm('products.view'));
        Route::post('brands', [BrandController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('brands/{id}', [BrandController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('brands/{id}', [BrandController::class, 'destroy'])->middleware($perm('products.manage'));

        // قوالب الوحدات (لا قيد؛ لكن المعامل يضرب الكمية الداخلة للمخزون)
        Route::get('unit-templates', [UnitTemplateController::class, 'index'])->middleware($perm('products.view'));
        Route::post('unit-templates', [UnitTemplateController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('unit-templates/{id}', [UnitTemplateController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('unit-templates/{id}', [UnitTemplateController::class, 'destroy'])->middleware($perm('products.manage'));

        // تقرير المخزون (قراءة فقط — لا أثر محاسبي)
        Route::get('inventory', [InventoryController::class, 'index'])->middleware($perm('products.view'));
        Route::get('inventory/{productId}/movements', [InventoryController::class, 'movements'])->middleware($perm('products.view'));

        // إعدادات المخزون (سياسة؛ تُقرأ فعلاً في حارس البيع بلا رصيد)
        Route::get('inventory-settings', [InventorySettingsController::class, 'show'])->middleware($perm('products.view'));
        Route::put('inventory-settings', [InventorySettingsController::class, 'update'])->middleware($perm('company.manage'));

        // دليل الحسابات: إدارة شجرية بلا حذف؛ التعطيل يمنع الترحيل الجديد ويحفظ الأثر التاريخي.
        Route::get('accounts', [AccountController::class, 'index'])->middleware($perm('accounts.view'));
        Route::get('accounts/{id}', [AccountController::class, 'show'])->middleware($perm('accounts.view'));
        Route::post('accounts', [AccountController::class, 'store'])->middleware($perm('accounts.manage'));
        Route::put('accounts/{id}', [AccountController::class, 'update'])->middleware($perm('accounts.manage'));

        // تصنيفات المصروفات: بيانات تحليلية بلا أثر محاسبي، تتحكم بها صلاحيات المصروفات.
        Route::get('expense-categories', [ExpenseCategoryController::class, 'index'])->middleware($perm('expenses.view'));
        Route::post('expense-categories', [ExpenseCategoryController::class, 'store'])->middleware($perm('expenses.manage'));
        Route::put('expense-categories/{id}', [ExpenseCategoryController::class, 'update'])->middleware($perm('expenses.manage'));
        Route::delete('expense-categories/{id}', [ExpenseCategoryController::class, 'destroy'])->middleware($perm('expenses.manage'));
        // المصروفات (مستند مالي؛ الترحيل يولّد قيداً متوازناً)
        Route::get('expenses', [ExpenseController::class, 'index'])->middleware($perm('expenses.view'));
        Route::get('expenses/{id}/attachments/{attachmentId}', [ExpenseController::class, 'downloadAttachment'])->middleware($perm('expenses.view'));
        Route::get('expenses/{id}', [ExpenseController::class, 'show'])->middleware($perm('expenses.view'));
        Route::post('expenses', [ExpenseController::class, 'store'])->middleware($perm('expenses.manage'));
        Route::put('expenses/{id}', [ExpenseController::class, 'update'])->middleware($perm('expenses.manage'));
        Route::post('expenses/{id}/duplicate', [ExpenseController::class, 'duplicate'])->middleware($perm('expenses.manage'));
        Route::delete('expenses/{id}', [ExpenseController::class, 'destroy'])->middleware($perm('expenses.manage'));
        Route::post('expenses/{id}/post', [ExpenseController::class, 'post'])->middleware($perm('expenses.manage'));

        // الأصول الثابتة (اقتناء + إهلاك؛ كلاهما يولّد قيداً متوازناً)
        Route::get('assets', [AssetController::class, 'index'])->middleware($perm('assets.view'));
        Route::get('assets/{id}', [AssetController::class, 'show'])->middleware($perm('assets.view'));
        Route::post('assets', [AssetController::class, 'store'])->middleware($perm('assets.manage'));
        Route::post('assets/{id}/post', [AssetController::class, 'post'])->middleware($perm('assets.manage'));
        Route::post('assets/{id}/depreciate', [AssetController::class, 'depreciate'])->middleware($perm('assets.manage'));

        // مراكز التكلفة (بيانات رئيسية — بُعد تحليلي للقيود)
        // المخازن — تحمل الكميات لكل موقع (التقييم يبقى عالمياً على المنتج).
        Route::get('warehouses', [WarehouseController::class, 'index'])->middleware($perm('products.view'));
        Route::get('warehouses/{id}', [WarehouseController::class, 'show'])->middleware($perm('products.view'));
        Route::get('warehouses/{id}/stock', [WarehouseController::class, 'stock'])->middleware($perm('products.view'));
        Route::post('warehouses', [WarehouseController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('warehouses/{id}', [WarehouseController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('warehouses/{id}', [WarehouseController::class, 'destroy'])->middleware($perm('products.manage'));

        // الفروع — بنية تنظيمية داخل المؤسسة (بيانات رئيسية، لا أثر محاسبي).
        Route::get('branches', [BranchController::class, 'index'])->middleware($perm('branches.view'));
        Route::get('branch-settings', [BranchSettingsController::class, 'show'])->middleware($perm('branches.view'));
        Route::put('branch-settings', [BranchSettingsController::class, 'update'])->middleware($perm('branches.manage'));
        Route::get('branches/{id}', [BranchController::class, 'show'])->middleware($perm('branches.view'));
        Route::post('branches', [BranchController::class, 'store'])->middleware($perm('branches.manage'));
        Route::put('branches/{id}', [BranchController::class, 'update'])->middleware($perm('branches.manage'));
        Route::delete('branches/{id}', [BranchController::class, 'destroy'])->middleware($perm('branches.manage'));

        Route::get('cost-centers', [CostCenterController::class, 'index'])->middleware($perm('cost_centers.view'));
        Route::post('cost-centers', [CostCenterController::class, 'store'])->middleware($perm('cost_centers.manage'));
        Route::put('cost-centers/{id}', [CostCenterController::class, 'update'])->middleware($perm('cost_centers.manage'));
        Route::delete('cost-centers/{id}', [CostCenterController::class, 'destroy'])->middleware($perm('cost_centers.manage'));

        // الفواتير
        Route::get('invoices', [InvoiceController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}', [InvoiceController::class, 'show'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}/payments', [InvoiceController::class, 'payments'])->middleware($perm('payments.view'));
        Route::get('invoices/{id}/accounting', [InvoiceController::class, 'accounting'])->middleware($perm('reports.view'));
        Route::get('invoices/{id}/inventory', [InvoiceController::class, 'inventory'])->middleware($perm('products.view'));
        Route::get('invoices/{id}/notes', [InvoiceController::class, 'notes'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}/notes/{noteId}/attachments/{attachmentId}/download', [InvoiceController::class, 'downloadNoteAttachment'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}/zatca', [InvoiceController::class, 'zatca'])->middleware($perm('zatca.view'));
        Route::post('invoices', [InvoiceController::class, 'store'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);
        Route::post('invoices/{id}/notes', [InvoiceController::class, 'storeNote'])->middleware($perm('invoices.manage'));
        Route::post('invoices/{id}/duplicate', [InvoiceController::class, 'duplicate'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);
        Route::put('invoices/{id}', [InvoiceController::class, 'update'])->middleware($perm('invoices.manage')); // مسوّدة فقط
        Route::delete('invoices/{id}', [InvoiceController::class, 'destroy'])->middleware($perm('invoices.manage')); // مسوّدة فقط
        Route::post('invoices/{id}/post', [InvoiceController::class, 'post'])->middleware($perm('invoices.manage'));

        // عروض الأسعار (مستند غير محاسبي؛ التحويل ينشئ فاتورة draft)
        Route::get('quotes', [QuoteController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('quotes/{id}', [QuoteController::class, 'show'])->middleware($perm('invoices.view'));
        Route::post('quotes', [QuoteController::class, 'store'])->middleware($perm('invoices.manage'));
        Route::put('quotes/{id}', [QuoteController::class, 'update'])->middleware($perm('invoices.manage'));
        Route::delete('quotes/{id}', [QuoteController::class, 'destroy'])->middleware($perm('invoices.manage'));
        Route::post('quotes/{id}/issue', [QuoteController::class, 'issue'])->middleware($perm('invoices.manage'));
        Route::post('quotes/{id}/revise', [QuoteController::class, 'revise'])->middleware($perm('invoices.manage'));
        Route::post('quotes/{id}/convert', [QuoteController::class, 'convert'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);

        // الإشعارات الدائنة (مستند مالي؛ الترحيل يولّد قيداً عكسياً)
        Route::get('credit-notes', [CreditNoteController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('credit-notes/{id}', [CreditNoteController::class, 'show'])->middleware($perm('invoices.view'));
        Route::post('credit-notes', [CreditNoteController::class, 'store'])->middleware($perm('invoices.manage'));
        Route::post('credit-notes/{id}/post', [CreditNoteController::class, 'post'])->middleware($perm('invoices.manage'));

        // الفواتير الدورية (قالب + جدولة؛ التوليد ينتج فاتورة draft)
        Route::get('recurring-invoices', [RecurringInvoiceController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('recurring-invoices/{id}', [RecurringInvoiceController::class, 'show'])->middleware($perm('invoices.view'));
        Route::post('recurring-invoices', [RecurringInvoiceController::class, 'store'])->middleware($perm('invoices.manage'));
        Route::delete('recurring-invoices/{id}', [RecurringInvoiceController::class, 'destroy'])->middleware($perm('invoices.manage'));
        Route::post('recurring-invoices/{id}/generate', [RecurringInvoiceController::class, 'generate'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);

        // جلسات نقطة البيع (تشغيلي — لا قيود)
        Route::post('pos/checkout', [PosController::class, 'checkout'])->middleware($perm('invoices.manage'));
        Route::get('pos-sessions', [PosSessionController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('pos-sessions/{id}/report', [PosSessionController::class, 'report'])->middleware($perm('invoices.view'));
        Route::post('pos-sessions/open', [PosSessionController::class, 'open'])->middleware($perm('invoices.manage'));
        Route::post('pos-sessions/{id}/close', [PosSessionController::class, 'close'])->middleware($perm('invoices.manage'));

        // إعدادات المالية: سياسة السماح أو المنع للتحويل عند الرصيد غير الكافي.
        Route::get('settings/finance', [FinanceSettingsController::class, 'show'])->middleware($perm('payments.view'));
        Route::put('settings/finance', [FinanceSettingsController::class, 'update'])->middleware($perm('payments.manage'));

        // أنواع التسوية: بيانات رئيسية مشتركة؛ لا تنشئ قيداً حتى تُبنى تسويات العُهَد.
        Route::get('settlement-types', [SettlementTypeController::class, 'index'])->middleware($perm('payments.view'));
        Route::post('settlement-types', [SettlementTypeController::class, 'store'])->middleware($perm('payments.manage'));
        Route::put('settlement-types/{id}', [SettlementTypeController::class, 'update'])->middleware($perm('payments.manage'));
        Route::delete('settlement-types/{id}', [SettlementTypeController::class, 'destroy'])->middleware($perm('payments.manage'));

        // الخزائن والحسابات البنكية والتحويلات الداخلية
        Route::get('cash-bank-accounts', [CashBankAccountController::class, 'index'])->middleware($perm('payments.view'));
        Route::get('cash-bank-accounts/{id}', [CashBankAccountController::class, 'show'])->middleware($perm('payments.view'));
        Route::post('cash-bank-accounts', [CashBankAccountController::class, 'store'])->middleware($perm('payments.manage'));
        Route::put('cash-bank-accounts/{id}', [CashBankAccountController::class, 'update'])->middleware($perm('payments.manage'));
        Route::post('cash-bank-accounts/{id}/deactivate', [CashBankAccountController::class, 'deactivate'])->middleware($perm('payments.manage'));
        Route::post('cash-bank-accounts/{id}/make-main', [CashBankAccountController::class, 'makeMain'])->middleware($perm('payments.manage'));
        Route::delete('cash-bank-accounts/{id}', [CashBankAccountController::class, 'destroy'])->middleware($perm('payments.manage'));
        Route::get('cash-bank-transfers', [CashBankAccountController::class, 'transfers'])->middleware($perm('payments.view'));
        Route::post('cash-bank-transfers', [CashBankAccountController::class, 'transfer'])->middleware($perm('payments.manage'));

        // المدفوعات
        Route::get('payments', [PaymentController::class, 'index'])->middleware($perm('payments.view'));
        Route::get('payments/{id}', [PaymentController::class, 'show'])->middleware($perm('payments.view'));
        Route::post('payments', [PaymentController::class, 'store'])->middleware($perm('payments.manage'));
        Route::put('payments/{id}', [PaymentController::class, 'update'])->middleware($perm('payments.manage'));
        Route::post('payments/{id}/duplicate', [PaymentController::class, 'duplicate'])->middleware($perm('payments.manage'));
        Route::delete('payments/{id}', [PaymentController::class, 'destroy'])->middleware($perm('payments.manage'));
        Route::post('payments/{id}/post', [PaymentController::class, 'post'])->middleware($perm('payments.manage'));

        // عُهَد الموظفين — مسودة ثم صرف مرحّل، وتسوية أحادية السطر بنوع نشط وقيد مستقل.
        Route::get('employee-custodies', [EmployeeCustodyController::class, 'index'])->middleware($perm('payments.view'));
        Route::get('employee-custodies/{id}', [EmployeeCustodyController::class, 'show'])->middleware($perm('payments.view'));
        Route::get('employee-custodies/{id}/settlements', [EmployeeCustodyController::class, 'indexSettlements'])->middleware($perm('payments.view'));
        Route::post('employee-custodies', [EmployeeCustodyController::class, 'store'])->middleware($perm('payments.manage'));
        Route::post('employee-custodies/{id}/settlements', [EmployeeCustodyController::class, 'storeSettlement'])->middleware($perm('payments.manage'));
        Route::put('employee-custodies/{id}', [EmployeeCustodyController::class, 'update'])->middleware($perm('payments.manage'));
        Route::post('employee-custodies/{id}/duplicate', [EmployeeCustodyController::class, 'duplicate'])->middleware($perm('payments.manage'));
        Route::delete('employee-custodies/{id}', [EmployeeCustodyController::class, 'destroy'])->middleware($perm('payments.manage'));
        Route::post('employee-custodies/{id}/post', [EmployeeCustodyController::class, 'post'])->middleware($perm('payments.manage'));

        // المشتريات
        Route::get('purchases', [PurchaseController::class, 'index'])->middleware($perm('purchases.view'));
        Route::get('purchases/{id}', [PurchaseController::class, 'show'])->middleware($perm('purchases.view'));
        Route::post('purchases', [PurchaseController::class, 'store'])->middleware($perm('purchases.manage'));
        Route::put('purchases/{id}', [PurchaseController::class, 'update'])->middleware($perm('purchases.manage'));    // مسوّدة فقط
        Route::delete('purchases/{id}', [PurchaseController::class, 'destroy'])->middleware($perm('purchases.manage')); // مسوّدة فقط
        Route::post('purchases/{id}/post', [PurchaseController::class, 'post'])->middleware($perm('purchases.manage'));

        // دورة الشراء: طلب → طلب عروض → عرض مورّد → أمر شراء (مستندات غير محاسبية)
        Route::get('procurement', [ProcurementController::class, 'index'])->middleware($perm('purchases.view'));
        Route::get('procurement/{id}', [ProcurementController::class, 'show'])->middleware($perm('purchases.view'));
        Route::post('procurement', [ProcurementController::class, 'store'])->middleware($perm('purchases.manage'));
        Route::put('procurement/{id}', [ProcurementController::class, 'update'])->middleware($perm('purchases.manage'));
        Route::delete('procurement/{id}', [ProcurementController::class, 'destroy'])->middleware($perm('purchases.manage'));
        Route::post('procurement/{id}/issue', [ProcurementController::class, 'issue'])->middleware($perm('purchases.manage'));
        Route::post('procurement/{id}/revise', [ProcurementController::class, 'revise'])->middleware($perm('purchases.manage'));
        Route::post('procurement/{id}/transition', [ProcurementController::class, 'transition'])->middleware($perm('purchases.manage'));
        Route::post('procurement/{id}/convert', [ProcurementController::class, 'convert'])->middleware($perm('purchases.manage'));

        // الأذون المخزنية (الترحيل يحرّك المخزون ويولّد القيد معاً)
        Route::get('stock-permits', [StockPermitController::class, 'index'])->middleware($perm('products.view'));
        Route::get('stock-permits/{id}', [StockPermitController::class, 'show'])->middleware($perm('products.view'));
        Route::post('stock-permits', [StockPermitController::class, 'store'])->middleware($perm('products.manage'));
        Route::post('stock-permits/{id}/post', [StockPermitController::class, 'post'])->middleware($perm('products.manage'));
        Route::delete('stock-permits/{id}', [StockPermitController::class, 'destroy'])->middleware($perm('products.manage'));

        // الجرد (الترحيل يصحّح الكمية ويولّد قيد الفرق معاً)
        Route::get('stocktakes', [StocktakeController::class, 'index'])->middleware($perm('products.view'));
        Route::get('stocktakes/{id}', [StocktakeController::class, 'show'])->middleware($perm('products.view'));
        Route::post('stocktakes', [StocktakeController::class, 'store'])->middleware($perm('products.manage'));
        Route::post('stocktakes/{id}/count', [StocktakeController::class, 'count'])->middleware($perm('products.manage'));
        Route::post('stocktakes/{id}/post', [StocktakeController::class, 'post'])->middleware($perm('products.manage'));
        Route::delete('stocktakes/{id}', [StocktakeController::class, 'destroy'])->middleware($perm('products.manage'));

        // سجلّ تغييرات المستندات (قراءة فقط — لا أثر محاسبي)
        Route::get('revisions', [DocumentRevisionController::class, 'feed'])->middleware($perm('invoices.view'));
        Route::get('revisions/{type}/{id}', [DocumentRevisionController::class, 'index'])->middleware($perm('invoices.view'));

        // لوحة التحكم: تفصيل المبيعات ببُعد (يوم/منتج/فئة/فرع/بائع) — قراءة فقط
        Route::get('dashboard/sales-breakdown', [DashboardController::class, 'salesBreakdown'])->middleware($perm('reports.view'));
        // تقارير المبيعات: تجميعات قراءة فقط مع نطاق تاريخ/فرع/عميل/صنف/مندوب وسداد.
        Route::get('reports/sales', [SalesReportController::class, 'show'])->middleware($perm('reports.view'));
        // تقارير المشتريات: فواتير شراء وسندات صرف مرحّلة فقط؛ لا أثر محاسبي جديد.
        Route::get('reports/purchases', [PurchaseReportController::class, 'show'])->middleware($perm('reports.view'));
        Route::get('reports/purchases/creators', [PurchaseReportController::class, 'creators'])->middleware($perm('reports.view'));
        // تقارير العملاء: قراءة من الفواتير وسندات القبض والمواعيد، بلا أثر محاسبي جديد.
        Route::get('reports/customers', [CustomerReportController::class, 'show'])->middleware($perm('reports.view'));
        // تقارير المخزون: قراءة من الأرصدة والحركات والأذون والجرد المرحّل فقط.
        Route::get('reports/inventory', [InventoryReportController::class, 'show'])->middleware($perm('reports.view'));

        // المرتجعات
        // سطور مستندٍ مصدر بكمياتها المتبقية للردّ — تسبق `returns/{id}` في
        // الترتيب فلا تبتلعها كمعرّف.
        Route::get('returns/returnable/{type}/{id}', ReturnableController::class)
            ->middleware($perm('returns.view'));
        // مستندات طرفٍ القابلة للردّ عليها، بسبب المنع لغير الصالح منها.
        Route::get('returns/sources/{type}', ReturnSourcesController::class)
            ->middleware($perm('returns.view'));
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

        // الورديات (الوحدة الثانية من معمار الموارد البشرية)
        Route::get('shifts', [ShiftController::class, 'index'])->middleware($perm('hr.view'));
        Route::post('shifts', [ShiftController::class, 'store'])->middleware($perm('hr.manage'));
        Route::put('shifts/{id}', [ShiftController::class, 'update'])->middleware($perm('hr.manage'));
        Route::delete('shifts/{id}', [ShiftController::class, 'destroy'])->middleware($perm('hr.manage'));

        // الحضور والانصراف (تمام الوحدة الثانية)
        Route::get('attendances', [AttendanceController::class, 'index'])->middleware($perm('hr.view'));
        Route::post('attendances', [AttendanceController::class, 'store'])->middleware($perm('hr.manage'));
        Route::put('attendances/{id}', [AttendanceController::class, 'update'])->middleware($perm('hr.manage'));
        Route::delete('attendances/{id}', [AttendanceController::class, 'destroy'])->middleware($perm('hr.manage'));

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

        // إعدادات المشتريات (تفضيلات؛ تُقرأ فعلاً في خدمتَي الشراء والمشتريات)
        Route::get('purchase-settings', [PurchaseSettingsController::class, 'show'])->middleware($perm('purchases.view'));
        Route::put('purchase-settings', [PurchaseSettingsController::class, 'update'])->middleware($perm('company.manage'));

        // إعدادات الترقيم المتسلسل — الموضع الواحد لسلاسل المستندات السبع عشرة
        Route::get('numbering-settings', [NumberingSettingsController::class, 'show'])->middleware($perm('invoices.view'));
        Route::put('numbering-settings', [NumberingSettingsController::class, 'update'])->middleware($perm('company.manage'));

        // إعدادات الفوترة الإلكترونية (نطاق عدّاد ICV) — منفصلة عن بادئات ترقيم المستندات
        Route::get('zatca-settings', [ZatcaSettingsController::class, 'show'])->middleware($perm('invoices.view'));
        Route::put('zatca-settings', [ZatcaSettingsController::class, 'update'])->middleware($perm('company.manage'));

        // أقسام إعدادات المبيعات المتعددة (حالات/تصميمات/قوائم أسعار/شحن…)
        Route::get('sales-config/{section}', [SalesConfigController::class, 'show'])->middleware($perm('invoices.view'));
        Route::put('sales-config/{section}', [SalesConfigController::class, 'update'])->middleware($perm('company.manage'));

        // مكتبة قوالب الطباعة: القراءة لمن يطبع مستندات، والإدارة لمالك/مدير الشركة.
        Route::get('print-templates', [PrintTemplateController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('print-templates/assignments', [PrintTemplateController::class, 'assignments'])->middleware($perm('invoices.view'));
        Route::get('print-templates/resolve', [PrintTemplateController::class, 'resolve'])->middleware($perm('invoices.view'));
        Route::get('print-templates/{id}', [PrintTemplateController::class, 'show'])->middleware($perm('invoices.view'));
        Route::post('print-templates', [PrintTemplateController::class, 'store'])->middleware($perm('company.manage'));
        Route::put('print-templates/{id}/draft', [PrintTemplateController::class, 'updateDraft'])->middleware($perm('company.manage'));
        Route::post('print-templates/{id}/publish', [PrintTemplateController::class, 'publish'])->middleware($perm('company.manage'));
        Route::post('print-templates/{id}/duplicate', [PrintTemplateController::class, 'duplicate'])->middleware($perm('company.manage'));
        Route::put('print-templates/assignments/default', [PrintTemplateController::class, 'assign'])->middleware($perm('company.manage'));

        // إعدادات العميل (تفضيلات غير محاسبية)
        Route::get('customer-settings', [CustomerSettingsController::class, 'show'])->middleware($perm('partners.view'));
        Route::put('customer-settings', [CustomerSettingsController::class, 'update'])->middleware($perm('company.manage'));

        // إدارة المستخدمين (owner/admin)
        Route::get('users', [UserController::class, 'index'])->middleware($perm('users.view'));
        Route::post('users', [UserController::class, 'store'])->middleware($perm('users.manage'));
        Route::put('users/{id}', [UserController::class, 'update'])->middleware($perm('users.manage'));
        Route::delete('users/{id}', [UserController::class, 'destroy'])->middleware($perm('users.manage'));

        // أدوار الصلاحيات القابلة للضبط (owner/admin) — مشروع أمني حسّاس
        Route::get('roles', [RoleController::class, 'index'])->middleware($perm('roles.view'));
        Route::post('roles', [RoleController::class, 'store'])->middleware($perm('roles.manage'));
        Route::put('roles/{id}', [RoleController::class, 'update'])->middleware($perm('roles.manage'));
        Route::delete('roles/{id}', [RoleController::class, 'destroy'])->middleware($perm('roles.manage'));

        // التقارير
        Route::get('reports/trial-balance', [ReportController::class, 'trialBalance'])->middleware($perm('reports.view'));
        Route::get('reports/income-statement', [ReportController::class, 'incomeStatement'])->middleware($perm('reports.view'));
        Route::get('reports/balance-sheet', [ReportController::class, 'balanceSheet'])->middleware($perm('reports.view'));
        Route::get('reports/account-ledger/{accountId}', [ReportController::class, 'accountLedger'])->middleware($perm('reports.view'));
        Route::get('reports/journal-entries', [ReportController::class, 'journalEntries'])->middleware($perm('reports.view'));
        Route::get('reports/cash-flow', [ReportController::class, 'cashFlow'])->middleware($perm('reports.view'));
        Route::get('reports/tax-report', [ReportController::class, 'taxReport'])->middleware($perm('reports.view'));
        Route::get('reports/partner-statement/{partnerId}', [ReportController::class, 'partnerStatement'])->middleware($perm('reports.view'));
        Route::get('reports/aging/{type}', [ReportController::class, 'aging'])->middleware($perm('reports.view'));
        Route::get('reports/cost-center-profitability', [ReportController::class, 'costCenterProfitability'])->middleware($perm('reports.view'));

        }); // نهاية مجموعة الاشتراك النشط
    });
});
