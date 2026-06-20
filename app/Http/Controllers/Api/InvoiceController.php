<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreInvoiceRequest;
use App\Http\Resources\InvoiceResource;
use App\Models\Invoice;
use App\Models\Partner;
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

        // عزل: الطرف يجب أن يخص المستأجر الحالي (وإلا 404)
        Partner::findOrFail($data['partner_id']);

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
