<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePosSaleRequest;
use App\Http\Resources\InvoiceResource;
use App\Models\Partner;
use App\Models\Product;
use App\Services\Accounting\PosService;
use Illuminate\Http\JsonResponse;

class PosController extends ApiController
{
    public function __construct(protected PosService $pos) {}

    /**
     * إتمام بيع نقطة البيع بوسائل متعدّدة (ذرّياً): فاتورة آجلة مرحّلة + سندات قبض
     * (نقد→1110، بطاقة/تحويل→1120). يعيد الفاتورة الناتجة.
     */
    public function checkout(StorePosSaleRequest $request): JsonResponse
    {
        $data = $request->validated();

        // عزل: المراجع تخصّ المستأجر الحالي.
        Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $invoice = $this->domain(fn () => $this->pos->checkout($data));

        return (new InvoiceResource($invoice->load('lines')))->response()->setStatusCode(201);
    }
}
