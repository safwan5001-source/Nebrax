<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreRecurringInvoiceRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\RecurringInvoiceResource;
use App\Models\Partner;
use App\Models\RecurringInvoice;
use App\Services\Accounting\RecurringInvoiceService;
use Illuminate\Http\JsonResponse;

class RecurringInvoiceController extends ApiController
{
    public function __construct(protected RecurringInvoiceService $recurring) {}

    public function index(): JsonResponse
    {
        return RecurringInvoiceResource::collection(RecurringInvoice::with('lines')->latest()->get())->response();
    }

    public function store(StoreRecurringInvoiceRequest $request): JsonResponse
    {
        $data = $request->validated();
        Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر

        $rec = $this->domain(fn () => $this->recurring->create($data, $data['items']));

        return (new RecurringInvoiceResource($rec->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new RecurringInvoiceResource(RecurringInvoice::with('lines')->findOrFail($id)))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        RecurringInvoice::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    public function generate(string $id): JsonResponse
    {
        $rec = RecurringInvoice::findOrFail($id);
        $invoice = $this->domain(fn () => $this->recurring->generate($rec));

        return (new InvoiceResource($invoice->load('lines')))->response()->setStatusCode(201);
    }
}
