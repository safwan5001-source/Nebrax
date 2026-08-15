<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreInvoiceRequest;
use App\Http\Resources\InvoiceResource;
use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Employee;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Services\Accounting\InvoiceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InvoiceController extends ApiController
{
    public function __construct(protected InvoiceService $invoices) {}

    public function index(Request $request): JsonResponse
    {
        return InvoiceResource::collection($this->scopeToActiveBranch(Invoice::with('lines')->latest(), $request)->get())->response();
    }

    public function store(StoreInvoiceRequest $request): JsonResponse
    {
        $data = $request->validated();

        // عزل: كل المراجع يجب أن تخص المستأجر الحالي (تصدّ حقن معرّفات مستأجرين آخرين)
        Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $invoice = $this->domain(fn () => $this->invoices->create($data, $data['items']));

        return (new InvoiceResource($invoice->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new InvoiceResource(Invoice::with(['lines', 'printTemplateRevision', 'pdfTemplateRevision'])->findOrFail($id)))->response();
    }

    /**
     * تعديل فاتورة مسوّدة (draft فقط) — نفس تحقّق المراجع في store.
     * المرحّلة immutable؛ الخدمة ترفضها (422).
     */
    public function update(StoreInvoiceRequest $request, string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id); // عزل تلقائي بالمستأجر
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $updated = $this->domain(fn () => $this->invoices->update($invoice, $data, $data['items']));

        return (new InvoiceResource($updated->load('lines')))->response();
    }

    /**
     * حذف فاتورة مسوّدة (draft فقط). المرحّلة لا تُحذف (سلامة الأثر المحاسبي).
     */
    public function destroy(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $this->domain(fn () => $this->invoices->deleteDraft($invoice));

        return response()->json(['message' => 'تم الحذف.']);
    }

    public function post(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $posted = $this->domain(fn () => $this->invoices->post($invoice));

        return (new InvoiceResource($posted->load(['lines', 'printTemplateRevision', 'pdfTemplateRevision'])))->response();
    }

    public function zatca(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);

        return response()->json([
            'qr'            => $invoice->zatca_qr,
            'hash'          => $invoice->zatca_hash,
            'uuid'          => $invoice->zatca_uuid,
            'icv'           => $invoice->zatca_icv,
            'previous_hash' => $invoice->zatca_previous_hash,
            'xml'           => $invoice->zatca_xml,
        ]);
    }
}
