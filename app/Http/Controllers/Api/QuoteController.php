<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreQuoteRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\QuoteResource;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Quote;
use App\Services\Accounting\QuoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuoteController extends ApiController
{
    public function __construct(protected QuoteService $quotes) {}

    public function index(Request $request): JsonResponse
    {
        return QuoteResource::collection($this->scopeToActiveBranch(Quote::with('lines')->latest(), $request)->get())->response();
    }

    public function store(StoreQuoteRequest $request): JsonResponse
    {
        $data = $request->validated();
        Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $quote = $this->domain(fn () => $this->quotes->create($data, $data['items']));

        return (new QuoteResource($quote->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new QuoteResource(Quote::with([
            'lines', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision', 'revisedFrom',
        ])->findOrFail($id)))->response();
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
        $quote = Quote::findOrFail($id);
        if ($quote->isPrintIssued()) {
            abort(422, 'لا يمكن حذف عرض سعر صادر للطباعة. أنشئ نسخة عمل أولاً.');
        }
        $quote->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** يثبت قوالب الإخراج ويقفل عرض السعر عند إجراء الإصدار الصريح. */
    public function issue(string $id): JsonResponse
    {
        $quote = Quote::findOrFail($id);
        $issued = $this->domain(fn () => $this->quotes->issueForPrint($quote));

        return (new QuoteResource($issued->load([
            'lines', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision', 'revisedFrom',
        ])))->response();
    }

    /** ينشئ نسخة عمل مسودة من عرض صادر من دون تعديل المستند التاريخي. */
    public function revise(string $id): JsonResponse
    {
        $quote = Quote::findOrFail($id);
        $revision = $this->domain(fn () => $this->quotes->createPrintRevision($quote));

        return (new QuoteResource($revision->load(['lines', 'revisedFrom'])))->response()->setStatusCode(201);
    }

    public function convert(Request $request, string $id): JsonResponse
    {
        $quote = Quote::findOrFail($id);
        $request->validate(['payment_type' => ['nullable', 'in:cash,credit']]);
        $paymentType = $request->input('payment_type', 'credit');

        $invoice = $this->domain(fn () => $this->quotes->convert($quote, $paymentType));

        return (new InvoiceResource($invoice->load('lines')))->response()->setStatusCode(201);
    }
}
