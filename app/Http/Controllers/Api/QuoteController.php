<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreQuoteRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\QuoteResource;
use App\Models\Partner;
use App\Models\Quote;
use App\Services\Accounting\QuoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuoteController extends ApiController
{
    public function __construct(protected QuoteService $quotes) {}

    public function index(): JsonResponse
    {
        return QuoteResource::collection(Quote::with('lines')->latest()->get())->response();
    }

    public function store(StoreQuoteRequest $request): JsonResponse
    {
        $data = $request->validated();
        Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر

        $quote = $this->domain(fn () => $this->quotes->create($data, $data['items']));

        return (new QuoteResource($quote->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new QuoteResource(Quote::with('lines')->findOrFail($id)))->response();
    }

    public function update(StoreQuoteRequest $request, string $id): JsonResponse
    {
        $quote = Quote::findOrFail($id);
        $data = $request->validated();
        Partner::findOrFail($data['partner_id']);

        $updated = $this->domain(fn () => $this->quotes->update($quote, $data, $data['items'] ?? null));

        return (new QuoteResource($updated->load('lines')))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Quote::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    public function convert(Request $request, string $id): JsonResponse
    {
        $quote = Quote::findOrFail($id);
        $paymentType = $request->input('payment_type', 'credit');

        $invoice = $this->domain(fn () => $this->quotes->convert($quote, $paymentType));

        return (new InvoiceResource($invoice->load('lines')))->response()->setStatusCode(201);
    }
}
