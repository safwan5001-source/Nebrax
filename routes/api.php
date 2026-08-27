<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AccountSettingsController;
use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\AssetController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\PlatformAuthController;
use App\Http\Controllers\Api\PlatformCommercialAssignmentController;
use App\Http\Controllers\Api\PlatformCommercialCatalogController;
use App\Http\Controllers\Api\PlatformDashboardController;
use App\Http\Controllers\Api\PlatformIntegrationController;
use App\Http\Controllers\Api\PlatformSubscriptionController;
use App\Http\Controllers\Api\PlatformTenantController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\BrandController;
use App\Http\Controllers\Api\BranchSettingsController;
use App\Http\Controllers\Api\CashBankAccountController;
use App\Http\Controllers\Api\ClassificationAnalyticsReportController;
use App\Http\Controllers\Api\ClassificationController;
use App\Http\Controllers\Api\CompanyController;
use App\Http\Controllers\Api\CorporateFuelContractController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\CostCenterController;
use App\Http\Controllers\Api\CreditNoteController;
use App\Http\Controllers\Api\CrmActivityController;
use App\Http\Controllers\Api\CustomerReportController;
use App\Http\Controllers\Api\CustomerSettingsController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DeliveryNoteController;
use App\Http\Controllers\Api\DepartmentController;
use App\Http\Controllers\Api\DocumentIntakeController;
use App\Http\Controllers\Api\DocumentRevisionController;
use App\Http\Controllers\Api\DocumentReviewController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\EmployeeCustodyController;
use App\Http\Controllers\Api\EmployeeRequestController;
use App\Http\Controllers\Api\EmploymentTypeController;
use App\Http\Controllers\Api\ExpenseCategoryController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\FinanceSettingsController;
use App\Http\Controllers\Api\FuelStationsWorkspaceController;
use App\Http\Controllers\Api\FuelAviController;
use App\Http\Controllers\Api\FuelStationMasterDataController;
use App\Http\Controllers\Api\FuelStationDeviceController;
use App\Http\Controllers\Api\FuelStationReadinessController;
use App\Http\Controllers\Api\FuelStationSettingsController;
use App\Http\Controllers\Api\FuelFleetController;
use App\Http\Controllers\Api\FuelShiftController;
use App\Http\Controllers\Api\FuelSaleController;
use App\Http\Controllers\Api\FuelReconciliationController;
use App\Http\Controllers\Api\FuelSupplyReceivingController;
use App\Http\Controllers\Api\FinancialControlAlertController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\InventoryReportController;
use App\Http\Controllers\Api\InventorySettingsController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\JobLevelController;
use App\Http\Controllers\Api\JobTitleController;
use App\Http\Controllers\Api\JournalEntryController;
use App\Http\Controllers\Api\LeaveRequestController;
use App\Http\Controllers\Api\LeaveTypeController;
use App\Http\Controllers\Api\ManualJournalController;
use App\Http\Controllers\Api\PartnerController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\PaymentMethodController;
use App\Http\Controllers\Api\PriceListController;
use App\Http\Controllers\Api\PayrollController;
use App\Http\Controllers\Api\ProductCategoryController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\PosController;
use App\Http\Controllers\Api\PosDeviceController;
use App\Http\Controllers\Api\PosSessionController;
use App\Http\Controllers\Api\PrintTemplateController;
use App\Http\Controllers\Api\ProcurementController;
use App\Http\Controllers\Api\PurchaseSettingsController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\PurchaseReportController;
use App\Http\Controllers\Api\QuoteController;
use App\Http\Controllers\Api\RecurringInvoiceController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ReportSettingsController;
use App\Http\Controllers\Api\RequestTypeController;
use App\Http\Controllers\Api\ReturnController;
use App\Http\Controllers\Api\ReturnableController;
use App\Http\Controllers\Api\ReturnSourcesController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SalesConfigController;
use App\Http\Controllers\Api\SalesReportController;
use App\Http\Controllers\Api\SalesSettingsController;
use App\Http\Controllers\Api\SettlementTypeController;
use App\Http\Controllers\Api\SelfServiceController;
use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Api\StockPermitController;
use App\Http\Controllers\Api\InventoryOpeningController;
use App\Http\Controllers\Api\StocktakeController;
use App\Http\Controllers\Api\SubscriptionController;
use App\Http\Controllers\Api\TenantApplicationController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\UnitTemplateController;
use App\Http\Controllers\Api\NumberPreviewController;
use App\Http\Controllers\Api\NumberingSettingsController;
use App\Http\Controllers\Api\WarehouseController;
use App\Http\Controllers\Api\ZatcaSettingsController;
use App\Http\Middleware\EnforcePlanLimit;
use App\Http\Middleware\EnsureActiveSubscription;
use App\Http\Middleware\EnsureApplicationActive;
use App\Http\Middleware\EnsureApplicationOperationActive;
use App\Http\Middleware\EnsureCommercialApplicationAccess;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\EnsurePlatformAdministrator;
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
Route::pattern('tenant', $uuid);
Route::pattern('assignment', $uuid);
Route::pattern('productId', $uuid);
Route::pattern('partnerId', $uuid);
Route::pattern('accountId', $uuid);
Route::pattern('batch', $uuid);
Route::pattern('file', $uuid);

// كل مسارات الـ API ترجع JSON موحّداً (بما فيها الأخطاء).
Route::middleware(ForceJsonResponse::class)->group(function () {

    // فحص صحّة للنشر (بلا مصادقة) — تستخدمه منصّة الاستضافة
    Route::get('health', HealthController::class);

    // عام (بلا مصادقة)
    Route::post('register', [AuthController::class, 'register'])->middleware('throttle:register');
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:5,1');

    // منصة التشغيل الداخلية: مصادقة مستقلة تماماً عن المستأجرين، ولا تمر عبر SetTenant.
    Route::post('platform/login', [PlatformAuthController::class, 'login'])->middleware('throttle:5,1');
    Route::middleware(['auth:sanctum', EnsurePlatformAdministrator::class])->prefix('platform')->group(function () {
        Route::post('logout', [PlatformAuthController::class, 'logout']);
        Route::get('me', [PlatformAuthController::class, 'me']);
        Route::get('overview', [PlatformDashboardController::class, 'overview']);
        Route::get('integrations', [PlatformIntegrationController::class, 'index']);
        Route::get('tenants', [PlatformTenantController::class, 'index']);
        Route::get('tenants/{tenant}', [PlatformTenantController::class, 'show']);
    });
    Route::middleware(['auth:sanctum', EnsurePlatformAdministrator::class . ':platform:manage'])
        ->prefix('platform')
        ->group(function () {
            Route::patch('tenants/{tenant}', [PlatformTenantController::class, 'update']);
            Route::put('integrations/{integration}', [PlatformIntegrationController::class, 'update']);
            Route::post('integrations/{integration}/test', [PlatformIntegrationController::class, 'test']);
            Route::get('prices', [PlatformSubscriptionController::class, 'prices']);
            Route::post('prices', [PlatformSubscriptionController::class, 'storePrice']);
            Route::post('tenants/{tenant}/subscriptions', [PlatformSubscriptionController::class, 'store']);
            Route::post('subscriptions/{subscription}/transition', [PlatformSubscriptionController::class, 'transition']);
            Route::post('subscriptions/{subscription}/cancel', [PlatformSubscriptionController::class, 'cancel']);
            Route::post('subscriptions/{subscription}/expire', [PlatformSubscriptionController::class, 'expire']);
            Route::get('subscriptions/{subscription}/events', [PlatformSubscriptionController::class, 'events']);
            Route::get('commercial-catalog', [PlatformCommercialCatalogController::class, 'index']);
            Route::post('commercial-product-versions/{version}/publish', [PlatformCommercialCatalogController::class, 'publishProduct']);
            Route::post('commercial-product-versions/{version}/retire', [PlatformCommercialCatalogController::class, 'retireProduct']);
            Route::post('commercial-plan-versions/{version}/publish', [PlatformCommercialCatalogController::class, 'publishPlan']);
            Route::post('commercial-plan-versions/{version}/retire', [PlatformCommercialCatalogController::class, 'retirePlan']);
            Route::get('tenants/{tenant}/commercial-applications', [PlatformCommercialAssignmentController::class, 'commercialApplications']);
            Route::get('tenants/{tenant}/commercial-assignments', [PlatformCommercialAssignmentController::class, 'index']);
            Route::get('tenants/{tenant}/commercial-access/{capabilityKey}', [PlatformCommercialAssignmentController::class, 'inspectAccess']);
            Route::post('tenants/{tenant}/commercial-assignments/preview', [PlatformCommercialAssignmentController::class, 'preview']);
            Route::post('tenants/{tenant}/commercial-assignments/plan', [PlatformCommercialAssignmentController::class, 'assignPlan']);
            Route::post('tenants/{tenant}/commercial-assignments/addon', [PlatformCommercialAssignmentController::class, 'assignAddon']);
            Route::post('tenants/{tenant}/commercial-trials/plan', [PlatformCommercialAssignmentController::class, 'startPlanTrial']);
            Route::post('tenants/{tenant}/commercial-trials/addon', [PlatformCommercialAssignmentController::class, 'startAddonTrial']);
            Route::post('tenants/{tenant}/commercial-assignments/{assignment}/schedule-cancellation', [PlatformCommercialAssignmentController::class, 'scheduleCancellationForTenant']);
            Route::post('tenants/{tenant}/commercial-assignments/{assignment}/cancel', [PlatformCommercialAssignmentController::class, 'cancelForTenant']);
            Route::post('tenants/{tenant}/commercial-assignments/{assignment}/revoke', [PlatformCommercialAssignmentController::class, 'revokeForTenant']);
            Route::post('commercial-assignments/{assignment}/payment-failure', [PlatformCommercialAssignmentController::class, 'paymentFailure']);
            Route::post('commercial-assignments/{assignment}/schedule-cancellation', [PlatformCommercialAssignmentController::class, 'scheduleCancellation']);
            Route::post('commercial-assignments/{assignment}/reconcile', [PlatformCommercialAssignmentController::class, 'reconcile']);
            Route::post('commercial-assignments/{assignment}/cancel', [PlatformCommercialAssignmentController::class, 'cancel']);
            Route::post('commercial-assignments/{assignment}/revoke', [PlatformCommercialAssignmentController::class, 'revoke']);
        });

    // محمي: مصادقة Sanctum + ضبط المستأجر (العزل التلقائي)
    Route::middleware(['auth:sanctum', SetTenant::class, SetBranch::class])->group(function () {
        // متاح دائماً (حتى مع اشتراك منتهٍ) لرؤية الحالة والخروج
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::put('account/preferences', [AccountSettingsController::class, 'updatePreferences']);
        Route::put('account/email', [AccountSettingsController::class, 'updateEmail'])->middleware('throttle:5,1');
        Route::put('account/password', [AccountSettingsController::class, 'updatePassword'])->middleware('throttle:5,1');
        Route::get('account/export', [AccountSettingsController::class, 'export'])->middleware('throttle:3,1');
        Route::get('subscription', [SubscriptionController::class, 'show']); // متاح حتى مع اشتراك منتهٍ
        // مرئية الشريط الجانبي لكل الأدوار — بلا RBAC، لتصحيح التنقّل الأساسي.
        Route::get('applications/nav-state', [TenantApplicationController::class, 'navState']);

        $perm = fn (string $p) => EnsurePermission::class . ':' . $p;
        $app = fn (string $k) => EnsureApplicationActive::class . ':' . $k;
        // للمسارات التي تُبنى بعد منصة الاستحقاقات: الإنفاذ التجاري المركب
        // إلزامي من اليوم الأول ولا يعتمد cohort rollout للجسور القديمة.
        $commercialApp = fn (string $k, string $operation = 'read') => EnsureCommercialApplicationAccess::class . ':' . $k . ',' . $operation;

        // الموارد تتطلب اشتراكاً نشطاً
        Route::middleware(EnsureActiveSubscription::class)->group(function () use ($perm, $app, $commercialApp) {

        // مركز المستندات — PR-2: استقبال يدوي خاص فقط، بلا OCR أو Queue أو إنشاء معاملات.
        Route::post('document-batches', [DocumentIntakeController::class, 'storeBatch'])
            ->middleware([$perm('documents.center.manage'), $commercialApp('document_center.core', 'write'), 'throttle:20,1']);
        Route::post('document-batches/{batch}/files', [DocumentIntakeController::class, 'storeFile'])
            ->middleware([$perm('documents.center.manage'), $commercialApp('document_center.core', 'write'), 'throttle:20,1']);
        Route::post('document-batches/{batch}/complete', [DocumentIntakeController::class, 'complete'])
            ->middleware([$perm('documents.center.manage'), $commercialApp('document_center.core', 'write'), 'throttle:20,1']);
        Route::get('document-files/{file}/download-url', [DocumentIntakeController::class, 'downloadUrl'])
            ->middleware([$perm('documents.center.view'), $commercialApp('document_center.core')]);
        Route::get('document-files/{file}/download', [DocumentIntakeController::class, 'download'])
            ->middleware([$perm('documents.center.view'), $commercialApp('document_center.core'), 'signed'])
            ->name('document-files.download');
        Route::get('document-batches', [DocumentReviewController::class, 'index'])->middleware([$perm('documents.center.view'), $commercialApp('document_center.core')]);
        Route::get('document-batches/{batch}/review', [DocumentReviewController::class, 'review'])->middleware([$perm('documents.center.view'), $commercialApp('document_center.core')]);
        Route::post('document-batches/{batch}/review-changes', [DocumentReviewController::class, 'change'])->middleware([$perm('documents.center.review'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-batches/{batch}/assign-reviewer', [DocumentReviewController::class, 'assign'])->middleware([$perm('documents.center.manage'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-match-results/{match}/confirm', [DocumentReviewController::class, 'confirm'])->middleware([$perm('documents.center.review'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-match-results/{match}/reject', [DocumentReviewController::class, 'reject'])->middleware([$perm('documents.center.review'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-issues/{issue}/resolve', [DocumentReviewController::class, 'resolve'])->middleware([$perm('documents.center.review'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-issues/{issue}/reopen', [DocumentReviewController::class, 'reopen'])->middleware([$perm('documents.center.review'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-batches/{batch}/revalidate-financial', [DocumentReviewController::class, 'revalidateFinancial'])->middleware([$perm('documents.center.review'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-batches/{batch}/create-purchase-draft', [DocumentReviewController::class, 'createPurchaseDraft'])->middleware([$perm('documents.center.build_draft'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-batches/{batch}/create-expense-draft', [DocumentReviewController::class, 'createExpenseDraft'])->middleware([$perm('documents.center.build_draft'), $commercialApp('document_center.core', 'write')]);
        Route::post('document-batches/{batch}/complete-review', [DocumentReviewController::class, 'complete'])->middleware([$perm('documents.center.review'), $commercialApp('document_center.core', 'write')]);

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
        Route::get('crm-activities', [CrmActivityController::class, 'index'])->middleware([$perm('partners.view'), $app('crm.follow_up')]);
        Route::get('crm-activities/{id}', [CrmActivityController::class, 'show'])->middleware([$perm('partners.view'), $app('crm.follow_up')]);
        Route::post('crm-activities', [CrmActivityController::class, 'store'])->middleware([$perm('partners.manage'), $app('crm.follow_up')]);
        Route::put('crm-activities/{id}', [CrmActivityController::class, 'update'])->middleware([$perm('partners.manage'), $app('crm.follow_up')]);
        Route::delete('crm-activities/{id}', [CrmActivityController::class, 'destroy'])->middleware([$perm('partners.manage'), $app('crm.follow_up')]);

        Route::delete('partners/{id}', [PartnerController::class, 'destroy'])->middleware($perm('partners.manage'));

        // المنتجات
        Route::get('products', [ProductController::class, 'index'])->middleware($perm('products.view'));
        Route::get('products/export', [ProductController::class, 'export'])->middleware($perm('products.view'));
        Route::get('products/import/template', [ProductController::class, 'importTemplate'])->middleware($perm('products.manage'));
        Route::get('products/import/fields', [ProductController::class, 'importFields'])->middleware($perm('products.manage'));
        Route::post('products/import/inspect', [ProductController::class, 'importInspect'])->middleware($perm('products.manage'));
        Route::post('products/import/preview', [ProductController::class, 'importPreview'])->middleware($perm('products.manage'));
        Route::post('products/import/apply', [ProductController::class, 'importApply'])->middleware($perm('products.manage'));
        Route::get('products/{id}', [ProductController::class, 'show'])->middleware($perm('products.view'));
        Route::get('products/{id}/activity', [ProductController::class, 'activity'])->middleware($perm('products.view'));
        Route::get('products/{id}/barcodes', [ProductController::class, 'indexBarcodes'])->middleware($perm('products.view'));
        Route::post('products/{id}/barcodes', [ProductController::class, 'storeBarcode'])->middleware($perm('products.manage'));
        Route::delete('products/{id}/barcodes/{barcodeId}', [ProductController::class, 'destroyBarcode'])->middleware($perm('products.manage'));
        Route::get('products/{id}/media', [ProductController::class, 'indexMedia'])->middleware($perm('products.view'));
        Route::post('products/{id}/media', [ProductController::class, 'storeMedia'])->middleware($perm('products.manage'));
        Route::get('products/{id}/media/{mediaId}/download', [ProductController::class, 'downloadMedia'])->middleware($perm('products.view'));
        Route::delete('products/{id}/media/{mediaId}', [ProductController::class, 'destroyMedia'])->middleware($perm('products.manage'));
        Route::post('products', [ProductController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('products/{id}', [ProductController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('products/{id}', [ProductController::class, 'destroy'])->middleware($perm('products.manage'));

        // تصنيفات المنتجات والعلامات التجارية (قوائم تصنيف — لا أثر محاسبي)
        Route::get('product-categories', [ProductCategoryController::class, 'index'])->middleware($perm('products.view'));
        Route::post('product-categories', [ProductCategoryController::class, 'store'])->middleware($perm('products.manage'));
        Route::put('product-categories/{id}', [ProductCategoryController::class, 'update'])->middleware($perm('products.manage'));
        Route::delete('product-categories/{id}', [ProductCategoryController::class, 'destroy'])->middleware($perm('products.manage'));

        // تصنيفات العملاء والموردين والمستندات: بُعد تحليلي لا يولّد قيداً.
        Route::get('classifications', [ClassificationController::class, 'index'])->middleware($perm('reports.view'));
        Route::post('classifications', [ClassificationController::class, 'store'])->middleware($perm('company.manage'));
        Route::put('classifications/{id}', [ClassificationController::class, 'update'])->middleware($perm('company.manage'));
        Route::delete('classifications/{id}', [ClassificationController::class, 'destroy'])->middleware($perm('company.manage'));

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
        Route::get('inventory', [InventoryController::class, 'index'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::get('inventory/{productId}/movements', [InventoryController::class, 'movements'])->middleware([$perm('products.view'), $app('inventory.core')]);

        // إعدادات المخزون (سياسة؛ تُقرأ فعلاً في حارس البيع بلا رصيد)
        Route::get('inventory-settings', [InventorySettingsController::class, 'show'])->middleware($perm('products.view'));
        Route::put('inventory-settings', [InventorySettingsController::class, 'update'])->middleware($perm('company.manage'));

        // دليل الحسابات: إدارة شجرية بلا حذف؛ التعطيل يمنع الترحيل الجديد ويحفظ الأثر التاريخي.
        Route::get('accounts', [AccountController::class, 'index'])->middleware($perm('accounts.view'));
        Route::get('accounts/{id}', [AccountController::class, 'show'])->middleware($perm('accounts.view'));
        Route::post('accounts', [AccountController::class, 'store'])->middleware($perm('accounts.manage'));
        Route::put('accounts/{id}', [AccountController::class, 'update'])->middleware($perm('accounts.manage'));

        // سجل القيود الموحّد للقراءة: آلي ويدوي، مع سطور ومصدر القيد.
        Route::get('journal-entries', [JournalEntryController::class, 'index'])->middleware($perm('accounts.view'));
        Route::get('journal-entries/{id}', [JournalEntryController::class, 'show'])->middleware($perm('accounts.view'));

        // القيود اليدوية: مسودة مستقلة ثم ترحيل حصري عبر LedgerService.
        Route::get('manual-journals', [ManualJournalController::class, 'index'])->middleware($perm('accounts.view'));
        Route::get('manual-journals/{id}', [ManualJournalController::class, 'show'])->middleware($perm('accounts.view'));
        Route::post('manual-journals', [ManualJournalController::class, 'store'])->middleware($perm('accounts.manage'));
        Route::put('manual-journals/{id}', [ManualJournalController::class, 'update'])->middleware($perm('accounts.manage'));
        Route::post('manual-journals/{id}/duplicate', [ManualJournalController::class, 'duplicate'])->middleware($perm('accounts.manage'));
        Route::post('manual-journals/{id}/post', [ManualJournalController::class, 'post'])->middleware($perm('accounts.manage'));
        Route::post('manual-journals/{id}/reverse', [ManualJournalController::class, 'reverse'])->middleware($perm('accounts.manage'));
        Route::delete('manual-journals/{id}', [ManualJournalController::class, 'destroy'])->middleware($perm('accounts.manage'));

        // تصنيفات المصروفات: بيانات تحليلية بلا أثر محاسبي، لكنها جزء من تشغيل finance.operations وتخضع أيضاً لصلاحيات المصروفات.
        Route::get('expense-categories', [ExpenseCategoryController::class, 'index'])->middleware([$perm('expenses.view'), $app('finance.operations')]);
        Route::post('expense-categories', [ExpenseCategoryController::class, 'store'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);
        Route::put('expense-categories/{id}', [ExpenseCategoryController::class, 'update'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);
        Route::delete('expense-categories/{id}', [ExpenseCategoryController::class, 'destroy'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);
        // المصروفات (مستند مالي؛ الترحيل يولّد قيداً متوازناً)
        // — نطاق finance.operations هنا وحده: العُهَد أدناه أيضاً. لا الخزائن/
        // الحسابات البنكية ولا السندات (`payments`)، فهي مرجع مشترك تستهلكه
        // شاشة السندات نفسها غير المرتبطة بأي مفتاح كتالوج (ميزة أساسية دوماً).
        Route::get('expenses', [ExpenseController::class, 'index'])->middleware([$perm('expenses.view'), $app('finance.operations')]);
        Route::get('expenses/{id}/attachments/{attachmentId}', [ExpenseController::class, 'downloadAttachment'])->middleware([$perm('expenses.view'), $app('finance.operations')]);
        Route::get('expenses/{id}', [ExpenseController::class, 'show'])->middleware([$perm('expenses.view'), $app('finance.operations')]);
        Route::post('expenses', [ExpenseController::class, 'store'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);
        Route::put('expenses/{id}', [ExpenseController::class, 'update'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);
        Route::post('expenses/{id}/duplicate', [ExpenseController::class, 'duplicate'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);
        Route::delete('expenses/{id}', [ExpenseController::class, 'destroy'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);
        Route::post('expenses/{id}/post', [ExpenseController::class, 'post'])->middleware([$perm('expenses.manage'), $app('finance.operations')]);

        // الأصول الثابتة (اقتناء + إهلاك؛ كلاهما يولّد قيداً متوازناً)
        Route::get('assets', [AssetController::class, 'index'])->middleware($perm('assets.view'));
        Route::get('assets/{id}', [AssetController::class, 'show'])->middleware($perm('assets.view'));
        Route::post('assets', [AssetController::class, 'store'])->middleware($perm('assets.manage'));
        Route::post('assets/{id}/post', [AssetController::class, 'post'])->middleware($perm('assets.manage'));
        Route::post('assets/{id}/depreciate', [AssetController::class, 'depreciate'])->middleware($perm('assets.manage'));

        // مراكز التكلفة (بيانات رئيسية — بُعد تحليلي للقيود)
        // المخازن — تحمل الكميات لكل موقع (التقييم يبقى عالمياً على المنتج).
        // القائمة (`GET warehouses`) بلا حجب: مرجع مشترك يستهلكه اختيار المخزن
        // في الفاتورة/المشتريات/نقطة البيع وفلاتر التقارير ونطاق وصول المستخدم
        // — بلا علاقة بميزة «المخزون» نفسها؛ حجبها يكسرها حتى في الحالة
        // الطبيعية (مخزن رئيسي واحد فقط). تفاصيل المخزن ورصيده محجوبان.
        Route::get('warehouses', [WarehouseController::class, 'index'])->middleware($perm('products.view'));
        Route::get('warehouses/next-code', [WarehouseController::class, 'nextCode'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::get('warehouses/{id}', [WarehouseController::class, 'show'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::get('warehouses/{id}/stock', [WarehouseController::class, 'stock'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::post('warehouses', [WarehouseController::class, 'store'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::put('warehouses/{id}', [WarehouseController::class, 'update'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::delete('warehouses/{id}', [WarehouseController::class, 'destroy'])->middleware([$perm('products.manage'), $app('inventory.core')]);

        // الفروع — بنية تنظيمية داخل المؤسسة (بيانات رئيسية، لا أثر محاسبي).
        // القراءة (`GET branches`) تبقى بلا حجب: مرجع مشترك تستهلكه شاشات أخرى
        // كثيرة بلا علاقة بميزة «إدارة الفروع» نفسها (نطاق وصول المستخدم،
        // فلاتر التقارير، إسناد المخزن/الوردية لفرع) — حجبها يكسرها حتى في
        // الحالة الطبيعية (فرع رئيسي واحد فقط). الإنفاذ على الإنشاء/التعديل
        // وحدهما، وهو ما يعكس فعلاً نية «تعطيل تعدد الفروع».
        Route::get('branches', [BranchController::class, 'index'])->middleware($perm('branches.view'));
        Route::get('branches/next-code', [BranchController::class, 'nextCode'])->middleware([$perm('branches.manage'), $app('company.branches')]);
        Route::get('branch-settings', [BranchSettingsController::class, 'show'])->middleware($perm('branches.view'));
        Route::put('branch-settings', [BranchSettingsController::class, 'update'])->middleware([$perm('branches.manage'), $app('company.branches')]);
        Route::get('branches/{id}', [BranchController::class, 'show'])->middleware($perm('branches.view'));
        Route::post('branches', [BranchController::class, 'store'])->middleware([$perm('branches.manage'), $app('company.branches')]);
        Route::put('branches/{id}', [BranchController::class, 'update'])->middleware([$perm('branches.manage'), $app('company.branches')]);
        Route::delete('branches/{id}', [BranchController::class, 'destroy'])->middleware([$perm('branches.manage'), $app('company.branches')]);

        Route::get('cost-centers', [CostCenterController::class, 'index'])->middleware($perm('cost_centers.view'));
        Route::post('cost-centers', [CostCenterController::class, 'store'])->middleware($perm('cost_centers.manage'));
        Route::put('cost-centers/{id}', [CostCenterController::class, 'update'])->middleware($perm('cost_centers.manage'));
        Route::delete('cost-centers/{id}', [CostCenterController::class, 'destroy'])->middleware($perm('cost_centers.manage'));

        // قوائم الأسعار: إعداد شركة مشترك يختاره البائع يدوياً في المسودة؛
        // سعر السطر النهائي يبقى لقطة مستقلة ولا يتغير بتعديل القائمة لاحقاً.
        Route::get('price-lists', [PriceListController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('price-lists/{id}', [PriceListController::class, 'show'])->middleware($perm('invoices.view'));
        Route::get('price-lists/{id}/resolve', [PriceListController::class, 'resolve'])->middleware($perm('invoices.manage'));
        Route::post('price-lists', [PriceListController::class, 'store'])->middleware($perm('company.manage'));
        Route::put('price-lists/{id}', [PriceListController::class, 'update'])->middleware($perm('company.manage'));
        Route::delete('price-lists/{id}', [PriceListController::class, 'destroy'])->middleware($perm('company.manage'));
        Route::post('price-lists/{id}/items', [PriceListController::class, 'storeItem'])->middleware($perm('company.manage'));
        Route::delete('price-lists/{id}/items/{itemId}', [PriceListController::class, 'destroyItem'])->middleware($perm('company.manage'));

        // الفواتير
        Route::get('invoices', [InvoiceController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}', [InvoiceController::class, 'show'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}/payments', [InvoiceController::class, 'payments'])->middleware($perm('payments.view'));
        Route::get('invoices/{id}/accounting', [InvoiceController::class, 'accounting'])->middleware($perm('reports.view'));
        Route::get('invoices/{id}/inventory', [InvoiceController::class, 'inventory'])->middleware($perm('products.view'));
        Route::get('invoices/{id}/notes', [InvoiceController::class, 'notes'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}/notes/{noteId}/attachments/{attachmentId}/download', [InvoiceController::class, 'downloadNoteAttachment'])->middleware($perm('invoices.view'));
        Route::get('invoices/{id}/zatca', [InvoiceController::class, 'zatca'])->middleware([$perm('zatca.view'), $app('compliance.zatca')]);
        Route::post('invoices', [InvoiceController::class, 'store'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);
        Route::post('invoices/{id}/notes', [InvoiceController::class, 'storeNote'])->middleware($perm('invoices.manage'));
        Route::post('invoices/{id}/duplicate', [InvoiceController::class, 'duplicate'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);
        Route::put('invoices/{id}/classification', [InvoiceController::class, 'updateClassification'])->middleware($perm('invoices.manage'));
        Route::put('invoices/{id}', [InvoiceController::class, 'update'])->middleware($perm('invoices.manage')); // مسوّدة فقط
        Route::delete('invoices/{id}', [InvoiceController::class, 'destroy'])->middleware($perm('invoices.manage')); // مسوّدة فقط
        Route::post('invoices/{id}/post', [InvoiceController::class, 'post'])->middleware($perm('invoices.manage'));

        // سندات التسليم العامة: دليل تشغيلي مستقل. لا فاتورة ولا مخزون ولا دفتر في PR-9.
        Route::post('delivery-notes/invoice-draft/preview', [DeliveryNoteController::class, 'previewInvoiceDraft'])
            ->middleware([$perm('delivery_notes.invoice'), $commercialApp('sales.invoicing', 'read')]);
        Route::post('delivery-notes/invoice-draft', [DeliveryNoteController::class, 'buildInvoiceDraft'])
            ->middleware([$perm('delivery_notes.invoice'), $commercialApp('sales.invoicing', 'write')]);
        Route::get('delivery-notes', [DeliveryNoteController::class, 'index'])
            ->middleware([$perm('delivery_notes.view'), $commercialApp('sales.invoicing', 'read')]);
        Route::get('delivery-notes/{id}', [DeliveryNoteController::class, 'show'])
            ->middleware([$perm('delivery_notes.view'), $commercialApp('sales.invoicing', 'read')]);
        Route::post('delivery-notes', [DeliveryNoteController::class, 'store'])
            ->middleware([$perm('delivery_notes.manage'), $commercialApp('sales.invoicing', 'write')]);
        Route::put('delivery-notes/{id}', [DeliveryNoteController::class, 'update'])
            ->middleware([$perm('delivery_notes.manage'), $commercialApp('sales.invoicing', 'write')]);
        Route::post('delivery-notes/{id}/confirm', [DeliveryNoteController::class, 'confirm'])
            ->middleware([$perm('delivery_notes.confirm'), $commercialApp('sales.invoicing', 'write')]);
        Route::post('delivery-notes/{id}/cancel', [DeliveryNoteController::class, 'cancel'])
            ->middleware([$perm('delivery_notes.cancel'), $commercialApp('sales.invoicing', 'write')]);

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
        Route::get('credit-notes', [CreditNoteController::class, 'index'])->middleware([$perm('invoices.view'), EnsureApplicationOperationActive::class . ':credit-note']);
        Route::get('credit-notes/{id}', [CreditNoteController::class, 'show'])->middleware([$perm('invoices.view'), EnsureApplicationOperationActive::class . ':credit-note']);
        Route::post('credit-notes', [CreditNoteController::class, 'store'])->middleware([$perm('invoices.manage'), EnsureApplicationOperationActive::class . ':credit-note']);
        Route::post('credit-notes/{id}/post', [CreditNoteController::class, 'post'])->middleware([$perm('invoices.manage'), EnsureApplicationOperationActive::class . ':credit-note']);

        // الفواتير الدورية (قالب + جدولة؛ التوليد ينتج فاتورة draft)
        Route::get('recurring-invoices', [RecurringInvoiceController::class, 'index'])->middleware($perm('invoices.view'));
        Route::get('recurring-invoices/{id}', [RecurringInvoiceController::class, 'show'])->middleware($perm('invoices.view'));
        Route::post('recurring-invoices', [RecurringInvoiceController::class, 'store'])->middleware($perm('invoices.manage'));
        Route::delete('recurring-invoices/{id}', [RecurringInvoiceController::class, 'destroy'])->middleware($perm('invoices.manage'));
        Route::post('recurring-invoices/{id}/generate', [RecurringInvoiceController::class, 'generate'])->middleware([$perm('invoices.manage'), EnforcePlanLimit::class . ':invoices']);

        // أجهزة وجلسات نقطة البيع (تشغيلي — لا قيود). الكاشير يقرأ الأجهزة
        // المتاحة لفتح ورديته، أما تهيئة الجهاز فتظل إدارة شركة لا صلاحية بيع.
        Route::get('pos-devices', [PosDeviceController::class, 'index'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos-devices', [PosDeviceController::class, 'store'])->middleware([$perm('company.manage'), $app('sales.pos')]);
        Route::put('pos-devices/{id}', [PosDeviceController::class, 'update'])->middleware([$perm('company.manage'), $app('sales.pos')]);
        // Pairing يطلب إدارة الشركة؛ لا يمرر أوامر ESC/POS أو أي حمولة خام للخادم.
        Route::post('pos-devices/{id}/cash-drawer/pair', [PosDeviceController::class, 'pairCashDrawer'])->middleware([$perm('company.manage'), $app('sales.pos')]);
        Route::post('pos-devices/{id}/cash-drawer/test', [PosDeviceController::class, 'testCashDrawer'])->middleware([$perm('pos.cash_drawer.open'), $app('sales.pos')]);
        Route::post('pos-devices/{id}/cash-drawer/test/complete', [PosDeviceController::class, 'completeCashDrawerTest'])->middleware([$perm('pos.cash_drawer.open'), $app('sales.pos')]);
        Route::post('pos-devices/{id}/cash-drawer/test/unavailable', [PosDeviceController::class, 'drawerBridgeUnavailable'])->middleware([$perm('pos.cash_drawer.open'), $app('sales.pos')]);
        Route::delete('pos-devices/{id}', [PosDeviceController::class, 'destroy'])->middleware([$perm('company.manage'), $app('sales.pos')]);
        Route::get('pos/products', [PosController::class, 'products'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos/checkout', [PosController::class, 'checkout'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::get('pos/recent-invoices', [PosController::class, 'recentInvoices'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::get('pos/held-sales', [PosController::class, 'heldSales'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos/held-sales', [PosController::class, 'storeHeldSale'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos/held-sales/{id}/resume', [PosController::class, 'resumeHeldSale'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::delete('pos/held-sales/{id}', [PosController::class, 'discardHeldSale'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::get('pos/returnable-invoices', [PosController::class, 'returnableInvoices'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::get('pos/returnable-invoices/{id}', [PosController::class, 'returnableInvoice'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos/returns/quote', [PosController::class, 'quoteReturn'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos/returns', [PosController::class, 'storeReturn'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos/exchanges/quote', [PosController::class, 'quoteExchange'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos/exchanges', [PosController::class, 'storeExchange'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::get('pos-sessions', [PosSessionController::class, 'index'])->middleware([$perm('invoices.view'), $app('sales.pos')]);
        Route::get('pos-sessions/{id}/report', [PosSessionController::class, 'report'])->middleware([$perm('invoices.view'), $app('sales.pos')]);
        Route::get('pos-sessions/{id}/cash-movements', [PosSessionController::class, 'cashMovements'])->middleware([$perm('invoices.view'), $app('sales.pos')]);
        Route::get('pos-sessions/{id}/events', [PosSessionController::class, 'events'])->middleware([$perm('invoices.view'), $app('sales.pos')]);
        Route::post('pos-sessions/open', [PosSessionController::class, 'open'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos-sessions/{id}/close', [PosSessionController::class, 'close'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos-sessions/{id}/cash-movements', [PosSessionController::class, 'recordCashMovement'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos-sessions/{id}/cash-drawer/open', [PosSessionController::class, 'openCashDrawer'])->middleware([$perm('pos.cash_drawer.open'), $app('sales.pos')]);
        // الإكمال لا يفتح شيئاً بذاته: يقبل فقط action قصير العمر موقّعاً أنشأه
        // الخادم بعد فتح يدوي مصرح أو بعد checkout ناجح، لذلك يكفي سياق البيع.
        Route::post('pos-sessions/{id}/cash-drawer/complete', [PosSessionController::class, 'completeCashDrawer'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos-sessions/{id}/cash-drawer/unavailable', [PosSessionController::class, 'cashDrawerBridgeUnavailable'])->middleware([$perm('invoices.manage'), $app('sales.pos')]);
        Route::post('pos-sessions/{id}/acknowledge-difference', [PosSessionController::class, 'acknowledgeDifference'])->middleware([$perm('pos.variance.approve'), $app('sales.pos')]);

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

        // طرق الدفع: بيان مالي مشترك يحدد وجهة السند ورسومه.
        Route::get('payment-methods', [PaymentMethodController::class, 'index'])->middleware($perm('payments.view'));
        Route::post('payment-methods', [PaymentMethodController::class, 'store'])->middleware($perm('payments.manage'));
        Route::put('payment-methods/{id}', [PaymentMethodController::class, 'update'])->middleware($perm('payments.manage'));
        Route::post('payment-methods/{id}/make-default', [PaymentMethodController::class, 'makeDefault'])->middleware($perm('payments.manage'));
        Route::delete('payment-methods/{id}', [PaymentMethodController::class, 'destroy'])->middleware($perm('payments.manage'));

        // كتالوج التطبيقات مدموجاً بحالة تفعيل المؤسسة — لا إنفاذ على مسارات أخرى بعد.
        Route::get('applications', [TenantApplicationController::class, 'index'])->middleware($perm('apps.view'));
        Route::post('applications/enable', [TenantApplicationController::class, 'enable'])->middleware($perm('apps.manage'));
        Route::post('applications/disable', [TenantApplicationController::class, 'disable'])->middleware($perm('apps.manage'));

        // Cycle 0: Workspace foundation only. لا CRUD ولا مبيعات ولا اتصال أجهزة
        // قبل دوراتها، لكن هذا المسار يثبت سلسلة RBAC + entitlement + حالة التطبيق.
        Route::get('fuel-stations/workspace', [FuelStationsWorkspaceController::class, 'index'])
            ->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);

        // Cycle 1: بيانات مرجعية فقط. كل كتابة تمرّ بالخدمة التي تتحقق من تطابق
        // المستأجر/المحطة/الفرع/الخزان/المضخة/المنتج، ولا تنشئ حركة أو قيداً.
        Route::get('fuel-stations/stations', [FuelStationMasterDataController::class, 'indexStations'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/stations/{id}', [FuelStationMasterDataController::class, 'showStation'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/stations', [FuelStationMasterDataController::class, 'storeStation'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::put('fuel-stations/stations/{id}', [FuelStationMasterDataController::class, 'updateStation'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::delete('fuel-stations/stations/{id}', [FuelStationMasterDataController::class, 'destroyStation'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        Route::get('fuel-stations/products', [FuelStationMasterDataController::class, 'indexFuelProducts'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/products/{id}', [FuelStationMasterDataController::class, 'showFuelProduct'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/products', [FuelStationMasterDataController::class, 'storeFuelProduct'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::put('fuel-stations/products/{id}', [FuelStationMasterDataController::class, 'updateFuelProduct'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::delete('fuel-stations/products/{id}', [FuelStationMasterDataController::class, 'destroyFuelProduct'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        Route::get('fuel-stations/tanks', [FuelStationMasterDataController::class, 'indexTanks'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/tanks/{id}', [FuelStationMasterDataController::class, 'showTank'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/tanks', [FuelStationMasterDataController::class, 'storeTank'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::put('fuel-stations/tanks/{id}', [FuelStationMasterDataController::class, 'updateTank'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::delete('fuel-stations/tanks/{id}', [FuelStationMasterDataController::class, 'destroyTank'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        Route::get('fuel-stations/pumps', [FuelStationMasterDataController::class, 'indexPumps'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/pumps/{id}', [FuelStationMasterDataController::class, 'showPump'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/pumps', [FuelStationMasterDataController::class, 'storePump'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::put('fuel-stations/pumps/{id}', [FuelStationMasterDataController::class, 'updatePump'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::delete('fuel-stations/pumps/{id}', [FuelStationMasterDataController::class, 'destroyPump'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        Route::get('fuel-stations/nozzles', [FuelStationMasterDataController::class, 'indexNozzles'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/nozzles/{id}', [FuelStationMasterDataController::class, 'showNozzle'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/nozzles', [FuelStationMasterDataController::class, 'storeNozzle'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::put('fuel-stations/nozzles/{id}', [FuelStationMasterDataController::class, 'updateNozzle'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::delete('fuel-stations/nozzles/{id}', [FuelStationMasterDataController::class, 'destroyNozzle'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        // Cycle 2: حدود التسوية وتعيينات حسابات الفروق إعدادات مدققة: tenant ثم station.
        Route::get('fuel-stations/settings', [FuelStationSettingsController::class, 'showTenant'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::put('fuel-stations/settings', [FuelStationSettingsController::class, 'updateTenant'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/stations/{id}/settings', [FuelStationSettingsController::class, 'showStation'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::put('fuel-stations/stations/{id}/settings', [FuelStationSettingsController::class, 'updateStation'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        // Cycle 2: evidence stays read-only until an explicit approved reconciliation posts inventory and ledger effects.
        Route::get('fuel-stations/readings', [FuelReconciliationController::class, 'readings'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/readings', [FuelReconciliationController::class, 'storeReading'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/reconciliations', [FuelReconciliationController::class, 'index'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/reconciliations', [FuelReconciliationController::class, 'store'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/reconciliations/{id}/approve', [FuelReconciliationController::class, 'approve'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        // Cycle 3 — استلام المورد → GRNI، ثم مطابقة فاتورة المورد بلا حركة مخزون ثانية.
        Route::get('fuel-stations/deliveries', [FuelSupplyReceivingController::class, 'deliveries'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/deliveries/{id}', [FuelSupplyReceivingController::class, 'showDelivery'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/deliveries', [FuelSupplyReceivingController::class, 'storeDelivery'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/deliveries/{id}/approve', [FuelSupplyReceivingController::class, 'approveDelivery'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/supplier-invoices', [FuelSupplyReceivingController::class, 'invoices'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/supplier-invoices/{id}', [FuelSupplyReceivingController::class, 'showInvoice'])->middleware([$perm('fuel_stations.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/supplier-invoices', [FuelSupplyReceivingController::class, 'storeInvoice'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/supplier-invoices/{id}/matches', [FuelSupplyReceivingController::class, 'matchInvoice'])->middleware([$perm('fuel_stations.manage'), $commercialApp('fuel_stations.core', 'write')]);

        // Cycle 4 — حقائق الشفت والـforecourt التشغيلية فقط؛ لا FuelSale/Payment/Invoice/ZATCA أو قيد تلقائي.
        Route::get('fuel-stations/shifts', [FuelShiftController::class, 'index'])->middleware([$perm('fuel.shift.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/shifts/{id}', [FuelShiftController::class, 'show'])->middleware([$perm('fuel.shift.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/shifts/open', [FuelShiftController::class, 'open'])->middleware([$perm('fuel.shift.open'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/staff', [FuelShiftController::class, 'assignStaff'])->middleware([$perm('fuel.shift.open'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/meter-readings', [FuelShiftController::class, 'recordMeter'])->middleware([$perm('fuel.shift.open'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/tank-readings', [FuelShiftController::class, 'recordTank'])->middleware([$perm('fuel.shift.open'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/cash-movements', [FuelShiftController::class, 'recordCashMovement'])->middleware([$perm('fuel.shift.cash_count'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/close', [FuelShiftController::class, 'close'])->middleware([$perm('fuel.shift.close'), $perm('fuel.shift.cash_count'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/approve', [FuelShiftController::class, 'approve'])->middleware([$perm('fuel.shift.approve'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/cash-variance/review', [FuelShiftController::class, 'reviewCashVariance'])->middleware([$perm('fuel.shift.cash_variance_review'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/shifts/{id}/corrections', [FuelShiftController::class, 'requestCorrection'])->middleware([$perm('fuel.shift.correct'), $commercialApp('fuel_stations.core', 'write')]);

        // Cycle 5 — بيع الوقود الرسمي: FuelSale → Invoice → Payment/Receipt منفصل.
        Route::get('fuel-stations/sales', [FuelSaleController::class, 'index'])->middleware([$perm('fuel.sale.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/sales/{id}', [FuelSaleController::class, 'show'])->middleware([$perm('fuel.sale.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/sales', [FuelSaleController::class, 'store'])->middleware([$perm('fuel.sale.create'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/sales/{id}/finalize', [FuelSaleController::class, 'finalize'])->middleware([$perm('fuel.sale.finalize'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/stations/{stationId}/sale-payment-methods', [FuelSaleController::class, 'paymentMethods'])->middleware([$perm('fuel.sale.collect'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/sales/{id}/payments', [FuelSaleController::class, 'collectPayment'])->middleware([$perm('fuel.sale.collect'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/prices', [FuelSaleController::class, 'priceIndex'])->middleware([$perm('fuel.sale.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/prices', [FuelSaleController::class, 'storePrice'])->middleware([$perm('fuel.sale.price.manage'), $commercialApp('fuel_stations.core', 'write')]);

        // Cycle 6: عقد شركات منفصل وسعره وحد ائتمانه؛ لا توجد صلاحية ضمنية
        // لمسؤول المحطة لتغيير هذه السياسات التجارية الحساسة.
        Route::get('fuel-stations/corporate-contracts', [CorporateFuelContractController::class, 'index'])->middleware([$perm('fuel.contract.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/corporate-contracts/{id}', [CorporateFuelContractController::class, 'show'])->middleware([$perm('fuel.contract.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/corporate-contracts', [CorporateFuelContractController::class, 'store'])->middleware([$perm('fuel.contract.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::put('fuel-stations/corporate-contracts/{id}', [CorporateFuelContractController::class, 'update'])->middleware([$perm('fuel.contract.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/corporate-contracts/{id}/activate', [CorporateFuelContractController::class, 'activate'])->middleware([$perm('fuel.contract.activate'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/corporate-contracts/{id}/suspend', [CorporateFuelContractController::class, 'suspend'])->middleware([$perm('fuel.contract.suspend'), $commercialApp('fuel_stations.core', 'write')]);
        Route::post('fuel-stations/corporate-contracts/{id}/prices', [CorporateFuelContractController::class, 'storePrice'])->middleware([$perm('fuel.contract.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/corporate-contracts/{id}/credit-exposure', [CorporateFuelContractController::class, 'exposure'])->middleware([$perm('fuel.credit.view'), $commercialApp('fuel_stations.core')]);
        Route::get('fuel-stations/fleet/vehicles', [FuelFleetController::class, 'vehicles'])->middleware([$perm('fuel.fleet.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/fleet/vehicles', [FuelFleetController::class, 'storeVehicle'])->middleware([$perm('fuel.fleet.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/fleet/drivers', [FuelFleetController::class, 'drivers'])->middleware([$perm('fuel.fleet.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/fleet/drivers', [FuelFleetController::class, 'storeDriver'])->middleware([$perm('fuel.fleet.manage'), $commercialApp('fuel_stations.core', 'write')]);
        Route::get('fuel-stations/fuel-cards', [FuelFleetController::class, 'cards'])->middleware([$perm('fuel.card.view'), $commercialApp('fuel_stations.core')]);
        Route::post('fuel-stations/fuel-cards', [FuelFleetController::class, 'storeCard'])->middleware([$perm('fuel.card.manage'), $commercialApp('fuel_stations.core', 'write')]);

        // Cycle 7 — هوية محايدة عن المورّد وقرار تفويض صريح؛ لا قارئ أو مضخة أو
        // adapter هنا. مسارات الإدارة لا تكشف قيمة الوسم الخام أو hash الاعتماد.
        Route::get('fuel-stations/avi-rfid/tags', [FuelAviController::class, 'indexTags'])->middleware([$perm('fuel.avi.view'), $commercialApp('fuel_stations.avi')]);
        Route::post('fuel-stations/avi-rfid/tags', [FuelAviController::class, 'storeTag'])->middleware([$perm('fuel.avi.manage'), $commercialApp('fuel_stations.avi', 'write')]);
        Route::put('fuel-stations/avi-rfid/tags/{id}', [FuelAviController::class, 'updateTag'])->middleware([$perm('fuel.avi.manage'), $commercialApp('fuel_stations.avi', 'write')]);
        Route::post('fuel-stations/avi-rfid/tags/{id}/replace', [FuelAviController::class, 'replaceTag'])->middleware([$perm('fuel.avi.manage'), $commercialApp('fuel_stations.avi', 'write')]);
        Route::get('fuel-stations/avi-rfid/authorizations', [FuelAviController::class, 'indexAuthorizations'])->middleware([$perm('fuel.avi.view'), $commercialApp('fuel_stations.avi')]);
        Route::post('fuel-stations/avi-rfid/authorizations', [FuelAviController::class, 'authorize'])->middleware([$perm('fuel.avi.authorize'), $commercialApp('fuel_stations.avi', 'write')]);

        // Cycle 8: سجل الأجهزة، سجل الأدلة المعيارية، ومحاكاة الاختبار. لا توجد
        // نقطة webhook عامة ولا اتصال مورد أو أمر مضخة في هذه الواجهات.
        Route::get('fuel-stations/devices', [FuelStationDeviceController::class, 'index'])->middleware([$perm('fuel.device.view'), $commercialApp('fuel_stations.integrations')]);
        Route::get('fuel-stations/devices/adapter-contracts', [FuelStationDeviceController::class, 'adapterContracts'])->middleware([$perm('fuel.device.view'), $commercialApp('fuel_stations.integrations')]);
        Route::post('fuel-stations/devices', [FuelStationDeviceController::class, 'store'])->middleware([$perm('fuel.device.manage'), $commercialApp('fuel_stations.integrations', 'write')]);
        Route::put('fuel-stations/devices/{id}', [FuelStationDeviceController::class, 'update'])->middleware([$perm('fuel.device.manage'), $commercialApp('fuel_stations.integrations', 'write')]);
        Route::delete('fuel-stations/devices/{id}', [FuelStationDeviceController::class, 'destroy'])->middleware([$perm('fuel.device.manage'), $commercialApp('fuel_stations.integrations', 'write')]);
        Route::get('fuel-stations/integration-events', [FuelStationDeviceController::class, 'indexEvents'])->middleware([$perm('fuel.integration.view'), $commercialApp('fuel_stations.integrations')]);
        Route::post('fuel-stations/devices/{id}/simulate-event', [FuelStationDeviceController::class, 'simulate'])->middleware([$perm('fuel.integration.ingest'), $commercialApp('fuel_stations.integrations', 'write')]);
        Route::post('fuel-stations/integration-events/{id}/retry', [FuelStationDeviceController::class, 'retry'])->middleware([$perm('fuel.integration.retry'), $commercialApp('fuel_stations.integrations', 'write')]);

        // Cycle 9: الصيانة والسلامة والتقارير قراءةً من الحقائق الرسمية فقط؛ لا
        // تفتح جهازاً ولا تنشئ قيداً أو مصروفاً أو أثراً مخزونياً مستقلاً.
        Route::get('fuel-stations/maintenance', [FuelStationReadinessController::class, 'maintenance'])->middleware([$perm('fuel.maintenance.view'), $commercialApp('fuel_stations.maintenance')]);
        Route::post('fuel-stations/maintenance/schedules', [FuelStationReadinessController::class, 'storeSchedule'])->middleware([$perm('fuel.maintenance.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/maintenance/work-orders', [FuelStationReadinessController::class, 'storeWorkOrder'])->middleware([$perm('fuel.maintenance.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/maintenance/work-orders/{id}/transition', [FuelStationReadinessController::class, 'transitionWorkOrder'])->middleware([$perm('fuel.maintenance.transition'), $commercialApp('fuel_stations.maintenance', 'write')]);

        Route::get('fuel-stations/safety', [FuelStationReadinessController::class, 'safety'])->middleware([$perm('fuel.safety.view'), $commercialApp('fuel_stations.maintenance')]);
        Route::post('fuel-stations/safety/inspections', [FuelStationReadinessController::class, 'storeInspection'])->middleware([$perm('fuel.safety.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/safety/inspections/{id}/perform', [FuelStationReadinessController::class, 'performInspection'])->middleware([$perm('fuel.safety.inspect'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/safety/findings/{id}/corrective-actions', [FuelStationReadinessController::class, 'storeCorrectiveAction'])->middleware([$perm('fuel.safety.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/safety/corrective-actions/{id}/transition', [FuelStationReadinessController::class, 'transitionCorrectiveAction'])->middleware([$perm('fuel.safety.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/safety/inspections/{id}/verify', [FuelStationReadinessController::class, 'verifyInspection'])->middleware([$perm('fuel.safety.verify'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/safety/inspections/{id}/close', [FuelStationReadinessController::class, 'closeInspection'])->middleware([$perm('fuel.safety.verify'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/safety/permits', [FuelStationReadinessController::class, 'storePermit'])->middleware([$perm('fuel.safety.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);

        Route::get('fuel-stations/alerts', [FuelStationReadinessController::class, 'alerts'])->middleware([$perm('fuel.alerts.view'), $commercialApp('fuel_stations.maintenance')]);
        Route::post('fuel-stations/alerts/scan', [FuelStationReadinessController::class, 'scanAlerts'])->middleware([$perm('fuel.alerts.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/alerts/{id}/acknowledge', [FuelStationReadinessController::class, 'acknowledgeAlert'])->middleware([$perm('fuel.alerts.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);
        Route::post('fuel-stations/alerts/{id}/assign', [FuelStationReadinessController::class, 'assignAlert'])->middleware([$perm('fuel.alerts.manage'), $commercialApp('fuel_stations.maintenance', 'write')]);

        Route::get('fuel-stations/dashboard', [FuelStationReadinessController::class, 'dashboard'])->middleware([$perm('fuel.reports.view'), $commercialApp('fuel_stations.maintenance')]);
        Route::get('fuel-stations/reports/{family}', [FuelStationReadinessController::class, 'report'])->middleware([$perm('fuel.reports.view'), $commercialApp('fuel_stations.maintenance')]);

        // المدفوعات
        Route::get('payments/collectors', [PaymentController::class, 'collectors'])->middleware($perm('payments.view'));
        Route::get('payments', [PaymentController::class, 'index'])->middleware($perm('payments.view'));
        Route::get('payments/{id}/attachments/{attachmentId}', [PaymentController::class, 'downloadAttachment'])->middleware($perm('payments.view'));
        Route::get('payments/{id}', [PaymentController::class, 'show'])->middleware($perm('payments.view'));
        Route::post('payments', [PaymentController::class, 'store'])->middleware($perm('payments.manage'));
        Route::put('payments/{id}/classification', [PaymentController::class, 'updateClassification'])->middleware($perm('payments.manage'));
        Route::put('payments/{id}', [PaymentController::class, 'update'])->middleware($perm('payments.manage'));
        Route::post('payments/{id}/duplicate', [PaymentController::class, 'duplicate'])->middleware($perm('payments.manage'));
        Route::delete('payments/{id}', [PaymentController::class, 'destroy'])->middleware($perm('payments.manage'));
        Route::post('payments/{id}/post', [PaymentController::class, 'post'])->middleware($perm('payments.manage'));

        // عُهَد الموظفين — مسودة ثم صرف مرحّل، وتسوية أحادية السطر بنوع نشط وقيد مستقل.
        Route::get('employee-custodies', [EmployeeCustodyController::class, 'index'])->middleware([$perm('payments.view'), $app('finance.operations')]);
        Route::get('employee-custodies/{id}', [EmployeeCustodyController::class, 'show'])->middleware([$perm('payments.view'), $app('finance.operations')]);
        Route::get('employee-custodies/{id}/settlements', [EmployeeCustodyController::class, 'indexSettlements'])->middleware([$perm('payments.view'), $app('finance.operations')]);
        Route::post('employee-custodies', [EmployeeCustodyController::class, 'store'])->middleware([$perm('payments.manage'), $app('finance.operations')]);
        Route::post('employee-custodies/{id}/settlements', [EmployeeCustodyController::class, 'storeSettlement'])->middleware([$perm('payments.manage'), $app('finance.operations')]);
        Route::put('employee-custodies/{id}', [EmployeeCustodyController::class, 'update'])->middleware([$perm('payments.manage'), $app('finance.operations')]);
        Route::post('employee-custodies/{id}/duplicate', [EmployeeCustodyController::class, 'duplicate'])->middleware([$perm('payments.manage'), $app('finance.operations')]);
        Route::delete('employee-custodies/{id}', [EmployeeCustodyController::class, 'destroy'])->middleware([$perm('payments.manage'), $app('finance.operations')]);
        Route::post('employee-custodies/{id}/post', [EmployeeCustodyController::class, 'post'])->middleware([$perm('payments.manage'), $app('finance.operations')]);

        // المشتريات
        Route::get('purchases', [PurchaseController::class, 'index'])->middleware([$perm('purchases.view'), $app('purchases.cycle')]);
        Route::get('purchases/{id}', [PurchaseController::class, 'show'])->middleware([$perm('purchases.view'), $app('purchases.cycle')]);
        Route::get('purchases/{id}/attachments', [PurchaseController::class, 'indexAttachments'])->middleware([$perm('purchases.view'), $app('purchases.cycle')]);
        Route::post('purchases/{id}/attachments', [PurchaseController::class, 'storeAttachments'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::get('purchases/{id}/attachments/{attachmentId}/download', [PurchaseController::class, 'downloadAttachment'])->middleware([$perm('purchases.view'), $app('purchases.cycle')]);
        Route::delete('purchases/{id}/attachments/{attachmentId}', [PurchaseController::class, 'destroyAttachment'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::get('purchases/{id}/payments', [PurchaseController::class, 'payments'])->middleware([$perm('payments.view'), $app('purchases.cycle')]);
        Route::get('purchases/{id}/accounting', [PurchaseController::class, 'accounting'])->middleware([$perm('reports.view'), $app('purchases.cycle')]);
        Route::get('purchases/{id}/inventory', [PurchaseController::class, 'inventory'])->middleware([$perm('products.view'), $app('purchases.cycle')]);
        Route::post('purchases', [PurchaseController::class, 'store'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::put('purchases/{id}/classification', [PurchaseController::class, 'updateClassification'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::put('purchases/{id}', [PurchaseController::class, 'update'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);    // مسوّدة فقط
        Route::post('purchases/{id}/duplicate', [PurchaseController::class, 'duplicate'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::delete('purchases/{id}', [PurchaseController::class, 'destroy'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]); // مسوّدة فقط
        Route::post('purchases/{id}/post', [PurchaseController::class, 'post'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);

        // دورة الشراء: طلب → طلب عروض → عرض مورّد → أمر شراء (مستندات غير محاسبية)
        Route::get('procurement', [ProcurementController::class, 'index'])->middleware([$perm('purchases.view'), $app('purchases.cycle')]);
        Route::get('procurement/{id}', [ProcurementController::class, 'show'])->middleware([$perm('purchases.view'), $app('purchases.cycle')]);
        Route::post('procurement', [ProcurementController::class, 'store'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::put('procurement/{id}', [ProcurementController::class, 'update'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::delete('procurement/{id}', [ProcurementController::class, 'destroy'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::post('procurement/{id}/issue', [ProcurementController::class, 'issue'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::post('procurement/{id}/revise', [ProcurementController::class, 'revise'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::post('procurement/{id}/transition', [ProcurementController::class, 'transition'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);
        Route::post('procurement/{id}/convert', [ProcurementController::class, 'convert'])->middleware([$perm('purchases.manage'), $app('purchases.cycle')]);

        // الأذون المخزنية (الترحيل يحرّك المخزون ويولّد القيد معاً)
        Route::get('stock-permits', [StockPermitController::class, 'index'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::get('stock-permits/{id}', [StockPermitController::class, 'show'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::post('stock-permits', [StockPermitController::class, 'store'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::post('stock-permits/{id}/post', [StockPermitController::class, 'post'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::delete('stock-permits/{id}', [StockPermitController::class, 'destroy'])->middleware([$perm('products.manage'), $app('inventory.core')]);

        // الجرد (الترحيل يصحّح الكمية ويولّد قيد الفرق معاً)
        // ─── الأرصدة الافتتاحية للمخزون ───
        // نفس حارسَي بقية المخزون (`products.*` + `inventory.core`): مصفوفة
        // الأدوار لا تعرف نطاق `inventory_*`، واختراعه كان سيجعل هذا المستند
        // الوحيد بصلاحية خاصة به بلا سبب.
        Route::get('inventory-openings', [InventoryOpeningController::class, 'index'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::get('inventory-openings/import/template', [InventoryOpeningController::class, 'template'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::get('inventory-openings/import/fields', [InventoryOpeningController::class, 'fields'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::post('inventory-openings/import/inspect', [InventoryOpeningController::class, 'inspect'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::post('inventory-openings/import/preview', [InventoryOpeningController::class, 'preview'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::post('inventory-openings/import/apply', [InventoryOpeningController::class, 'apply'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::get('inventory-openings/{id}', [InventoryOpeningController::class, 'show'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::post('inventory-openings/{id}/post', [InventoryOpeningController::class, 'post'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::delete('inventory-openings/{id}', [InventoryOpeningController::class, 'destroy'])->middleware([$perm('products.manage'), $app('inventory.core')]);

        Route::get('stocktakes', [StocktakeController::class, 'index'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::get('stocktakes/{id}', [StocktakeController::class, 'show'])->middleware([$perm('products.view'), $app('inventory.core')]);
        Route::post('stocktakes', [StocktakeController::class, 'store'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::post('stocktakes/{id}/count', [StocktakeController::class, 'count'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::post('stocktakes/{id}/post', [StocktakeController::class, 'post'])->middleware([$perm('products.manage'), $app('inventory.core')]);
        Route::delete('stocktakes/{id}', [StocktakeController::class, 'destroy'])->middleware([$perm('products.manage'), $app('inventory.core')]);

        // سجلّ تغييرات المستندات (قراءة فقط — لا أثر محاسبي)
        Route::get('revisions', [DocumentRevisionController::class, 'feed'])->middleware($perm('invoices.view'));
        Route::get('revisions/{type}/{id}', [DocumentRevisionController::class, 'index'])->middleware($perm('invoices.view'));

        // لوحة التحكم: تفصيل المبيعات ببُعد (يوم/منتج/فئة/فرع/بائع) — قراءة فقط
        Route::get('dashboard/sales-breakdown', [DashboardController::class, 'salesBreakdown'])->middleware($perm('reports.view'));
        // تقارير المبيعات: تجميعات قراءة فقط مع نطاق تاريخ/فرع/عميل/صنف/مندوب وسداد.
        // سياسة تعديل البعد التحليلي للتصنيف قبل الترحيل وبعده.
        Route::get('settings/reports', [ReportSettingsController::class, 'show'])->middleware($perm('reports.view'));
        Route::put('settings/reports', [ReportSettingsController::class, 'update'])->middleware($perm('company.manage'));

        Route::get('reports/classification-analytics', [ClassificationAnalyticsReportController::class, 'show'])->middleware($perm('reports.view'));
        Route::get('reports/sales', [SalesReportController::class, 'show'])->middleware($perm('reports.view'));
        // تقارير المشتريات: فواتير شراء وسندات صرف مرحّلة فقط؛ لا أثر محاسبي جديد.
        Route::get('reports/purchases', [PurchaseReportController::class, 'show'])->middleware($perm('reports.view'));
        Route::get('reports/purchases/creators', [PurchaseReportController::class, 'creators'])->middleware($perm('reports.view'));
        // تقارير العملاء: قراءة من الفواتير وسندات القبض والمواعيد، بلا أثر محاسبي جديد.
        Route::get('reports/customers', [CustomerReportController::class, 'show'])->middleware($perm('reports.view'));
        // تقارير المخزون: قراءة من الأرصدة والحركات والأذون والجرد المرحّل فقط.
        Route::get('reports/inventory', [InventoryReportController::class, 'show'])->middleware([$perm('reports.view'), $app('inventory.core')]);

        // المرتجعات
        // سطور مستندٍ مصدر بكمياتها المتبقية للردّ — تسبق `returns/{id}` في
        // الترتيب فلا تبتلعها كمعرّف.
        Route::get('returns/returnable/{type}/{id}', ReturnableController::class)
            ->middleware([$perm('returns.view'), EnsureApplicationOperationActive::class . ':return']);
        // مستندات طرفٍ القابلة للردّ عليها، بسبب المنع لغير الصالح منها.
        Route::get('returns/sources/{type}', ReturnSourcesController::class)
            ->middleware([$perm('returns.view'), EnsureApplicationOperationActive::class . ':return']);
        Route::get('returns', [ReturnController::class, 'index'])->middleware([$perm('returns.view'), EnsureApplicationOperationActive::class . ':return']);
        Route::get('returns/{id}', [ReturnController::class, 'show'])->middleware([$perm('returns.view'), EnsureApplicationOperationActive::class . ':return']);
        Route::post('returns', [ReturnController::class, 'store'])->middleware([$perm('returns.manage'), EnsureApplicationOperationActive::class . ':return']);
        Route::post('returns/{id}/post', [ReturnController::class, 'post'])->middleware([$perm('returns.manage'), EnsureApplicationOperationActive::class . ':return']);

        // الموظفون (HR) — القائمة (`GET employees`) تبقى بلا حجب: مرجع مشترك
        // يستهلكه اختيار البائع في الفاتورة وربط حساب المستخدم بموظف، بلا
        // علاقة بميزة «إدارة الموظفين» نفسها. تفاصيل الموظف وإدارته محجوبة.
        Route::get('employees', [EmployeeController::class, 'index'])->middleware($perm('hr.view'));
        Route::get('employees/{id}', [EmployeeController::class, 'show'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('employees', [EmployeeController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('employees/{id}', [EmployeeController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('employees/{id}', [EmployeeController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::get('employees/{id}/photo', [EmployeeController::class, 'showPhoto'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('employees/{id}/photo', [EmployeeController::class, 'uploadPhoto'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('employees/{id}/photo', [EmployeeController::class, 'removePhoto'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        // مسوّغات التعيين (مرفقات الموظف)
        Route::get('employees/{id}/attachments', [EmployeeController::class, 'indexAttachments'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('employees/{id}/attachments', [EmployeeController::class, 'storeAttachments'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::get('employees/{id}/attachments/{attachmentId}/download', [EmployeeController::class, 'downloadAttachment'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::delete('employees/{id}/attachments/{attachmentId}', [EmployeeController::class, 'destroyAttachment'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // عقود العمل — مصدر الراتب الفعلي، انظر design-system/foundations/hr-users-architecture.md
        Route::get('employees/{id}/contracts', [EmployeeController::class, 'indexContracts'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('employees/{id}/contracts', [EmployeeController::class, 'storeContracts'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('employees/{id}/contracts/{contractId}', [EmployeeController::class, 'updateContract'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('employees/{id}/contracts/{contractId}', [EmployeeController::class, 'destroyContract'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // الإجازات — نوعٌ فقط + رصيدٌ مباشر (نطاق البناء الأول)، بلا أثرٍ مالي آلي.
        Route::get('employees/{id}/leave-requests', [EmployeeController::class, 'indexLeaveRequests'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('employees/{id}/leave-requests', [EmployeeController::class, 'storeLeaveRequests'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::get('employees/{id}/leave-balances', [EmployeeController::class, 'leaveBalances'])->middleware([$perm('hr.view'), $app('hr.employees')]);

        Route::get('leave-types', [LeaveTypeController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('leave-types', [LeaveTypeController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('leave-types/{id}', [LeaveTypeController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('leave-types/{id}', [LeaveTypeController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // طابور الموافقة عبر كل الموظفين — انظر LeaveRequestController.
        Route::get('leave-requests', [LeaveRequestController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('leave-requests/{id}/approve', [LeaveRequestController::class, 'approve'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::post('leave-requests/{id}/reject', [LeaveRequestController::class, 'reject'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('leave-requests/{id}', [LeaveRequestController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // إدارة الطلبات — أنواع ثابتة بحقول موحّدة (نطاق البناء الأول)، منفصلة عن الإجازات عمداً.
        Route::get('employees/{id}/requests', [EmployeeController::class, 'indexRequests'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('employees/{id}/requests', [EmployeeController::class, 'storeRequests'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        Route::get('request-types', [RequestTypeController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('request-types', [RequestTypeController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('request-types/{id}', [RequestTypeController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('request-types/{id}', [RequestTypeController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // طابور الموافقة عبر كل الموظفين — انظر EmployeeRequestController.
        Route::get('requests', [EmployeeRequestController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('requests/{id}/approve', [EmployeeRequestController::class, 'approve'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::post('requests/{id}/reject', [EmployeeRequestController::class, 'reject'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('requests/{id}', [EmployeeRequestController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // الهيكل التنظيمي — مسمى وظيفي/قسم/مستوى وظيفي/نوع وظيفة ككيانات مُدارة.
        Route::get('job-titles', [JobTitleController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('job-titles', [JobTitleController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('job-titles/{id}', [JobTitleController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('job-titles/{id}', [JobTitleController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        Route::get('departments', [DepartmentController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('departments', [DepartmentController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('departments/{id}', [DepartmentController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('departments/{id}', [DepartmentController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        Route::get('job-levels', [JobLevelController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('job-levels', [JobLevelController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('job-levels/{id}', [JobLevelController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('job-levels/{id}', [JobLevelController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        Route::get('employment-types', [EmploymentTypeController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('employment-types', [EmploymentTypeController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('employment-types/{id}', [EmploymentTypeController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('employment-types/{id}', [EmploymentTypeController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // الورديات (الوحدة الثانية من معمار الموارد البشرية)
        Route::get('shifts', [ShiftController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('shifts', [ShiftController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('shifts/{id}', [ShiftController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('shifts/{id}', [ShiftController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // الحضور والانصراف (تمام الوحدة الثانية)
        Route::get('attendances', [AttendanceController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('attendances', [AttendanceController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::put('attendances/{id}', [AttendanceController::class, 'update'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::delete('attendances/{id}', [AttendanceController::class, 'destroy'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // مسيّرات الرواتب
        Route::get('payroll-runs', [PayrollController::class, 'index'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::get('payroll-runs/{id}', [PayrollController::class, 'show'])->middleware([$perm('hr.view'), $app('hr.employees')]);
        Route::post('payroll-runs', [PayrollController::class, 'store'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::post('payroll-runs/{id}/post', [PayrollController::class, 'post'])->middleware([$perm('hr.manage'), $app('hr.employees')]);
        Route::post('payroll-runs/{id}/pay', [PayrollController::class, 'pay'])->middleware([$perm('hr.manage'), $app('hr.employees')]);

        // بوابة الخدمة الذاتية للموظف — دورٌ مقيَّد (self_service.access)، لا hr.*
        // (تلك غير معزولة صفّياً). كل مسارٍ هنا مقيَّدٌ بنيوياً بـ employee_id
        // المستخدم نفسه — انظر SelfServiceController.
        Route::get('me/profile', [SelfServiceController::class, 'profile'])->middleware([$perm('self_service.access'), $app('hr.employees')]);
        Route::get('me/contract', [SelfServiceController::class, 'contract'])->middleware([$perm('self_service.access'), $app('hr.employees')]);
        Route::get('me/payroll-items', [SelfServiceController::class, 'payrollItems'])->middleware([$perm('self_service.access'), $app('hr.employees')]);
        Route::get('me/attendances', [SelfServiceController::class, 'attendances'])->middleware([$perm('self_service.access'), $app('hr.employees')]);
        Route::post('me/attendance/check-in', [SelfServiceController::class, 'checkIn'])->middleware([$perm('self_service.access'), $app('hr.employees')]);
        Route::post('me/attendance/check-out', [SelfServiceController::class, 'checkOut'])->middleware([$perm('self_service.access'), $app('hr.employees')]);

        // إعدادات الشركة (owner/admin) — تحديث ملف فقط، لا أثر محاسبي
        Route::put('company', [CompanyController::class, 'update'])->middleware($perm('company.manage'));

        // إعدادات المبيعات (تفضيلات غير محاسبية)
        Route::get('sales-settings', [SalesSettingsController::class, 'show'])->middleware($perm('invoices.view'));
        Route::put('sales-settings', [SalesSettingsController::class, 'update'])->middleware($perm('company.manage'));

        // إعدادات المشتريات (تفضيلات؛ تُقرأ فعلاً في خدمتَي الشراء والمشتريات)
        Route::get('purchase-settings', [PurchaseSettingsController::class, 'show'])->middleware([$perm('purchases.view'), $app('purchases.cycle')]);
        Route::put('purchase-settings', [PurchaseSettingsController::class, 'update'])->middleware([$perm('company.manage'), $app('purchases.cycle')]);

        // إعدادات الترقيم المتسلسل — الموضع الواحد لسلاسل المستندات السبع عشرة
        Route::get('number-preview', [NumberPreviewController::class, 'show']);
        Route::get('numbering-settings', [NumberingSettingsController::class, 'show'])->middleware($perm('invoices.view'));
        Route::put('numbering-settings', [NumberingSettingsController::class, 'update'])->middleware($perm('company.manage'));

        // إعدادات الفوترة الإلكترونية (نطاق عدّاد ICV) — منفصلة عن بادئات ترقيم المستندات
        Route::get('zatca-settings', [ZatcaSettingsController::class, 'show'])->middleware([$perm('invoices.view'), $app('compliance.zatca')]);
        Route::put('zatca-settings', [ZatcaSettingsController::class, 'update'])->middleware([$perm('company.manage'), $app('compliance.zatca')]);

        // POS قسم تشغيلي مستقل داخل متحكم إعدادات مشترك؛ يسبق الـ wildcard
        // كي تظل بقية أقسام المبيعات core/shared ولا تُحجب بسبب POS.
        Route::get('sales-config/pos', [SalesConfigController::class, 'show'])
            ->defaults('section', 'pos')
            ->middleware([$perm('invoices.view'), $app('sales.pos')]);
        Route::put('sales-config/pos', [SalesConfigController::class, 'update'])
            ->defaults('section', 'pos')
            ->middleware([$perm('company.manage'), $app('sales.pos')]);

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

        // تنبيهات رقابية داخلية — لا تغيّر القيود أو مستنداتها.
        Route::get('financial-control-alerts', [FinancialControlAlertController::class, 'index'])->middleware($perm('reports.view'));
        Route::get('financial-control-alerts/{id}', [FinancialControlAlertController::class, 'show'])->middleware($perm('reports.view'));
        Route::post('financial-control-alerts/{id}/acknowledge', [FinancialControlAlertController::class, 'acknowledge'])->middleware($perm('accounts.manage'));
        Route::post('financial-control-alerts/run-check', [FinancialControlAlertController::class, 'runCheck'])->middleware($perm('accounts.manage'));

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
