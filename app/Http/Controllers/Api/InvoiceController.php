<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreInvoiceRequest;
use App\Http\Resources\InvoiceResource;
use App\Models\CostCenter;
use App\Models\Employee;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Services\Accounting\InvoiceService;
use Illuminate\Http\JsonResponse;

class InvoiceController extends ApiController
{
    public function __construct(protected InvoiceService $invoices) {}

    public function index(): JsonResponse
    {
        return InvoiceResource::collection(Invoice::with('lines')->latest()->get())->response();
    }

    public function store(StoreInvoiceRequest $request): JsonResponse
    {
        $data = $request->validated();

        // عزل: كل المراجع يجب أن تخص المستأجر الحالي (تصدّ حقن معرّفات مستأجرين آخرين)
        Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $invoice = $this->domain(fn () => $this->invoices->create($data, $data['items']));

        return (new InvoiceResource($invoice->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new InvoiceResource(Invoice::with('lines')->findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $posted = $this->domain(fn () => $this->invoices->post($invoice));

        return (new InvoiceResource($posted->load('lines')))->response();
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
