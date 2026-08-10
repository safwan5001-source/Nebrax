<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentRequest;
use App\Http\Resources\PaymentResource;
use App\Models\Partner;
use App\Models\Invoice;
use App\Models\Payment;
use App\Services\Accounting\PaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentController extends ApiController
{
    public function __construct(protected PaymentService $payments) {}

    /**
     * قائمة المدفوعات، مع تصفية اختيارية بالاتجاه (`?direction=received|paid`)
     * تفصل شاشتَي مدفوعات العملاء (قبض) والموردين (صرف).
     * بلا اتجاه تُعاد كلها — توافق رجعي كامل.
     */
    public function index(Request $request): JsonResponse
    {
        $direction = $request->query('direction');

        $query = Payment::latest();
        if (in_array($direction, ['received', 'paid'], true)) {
            $query->where('direction', $direction);
        }

        return PaymentResource::collection(
            $this->scopeToActiveBranch($query, $request)->get()
        )->response();
    }

    public function store(StorePaymentRequest $request): JsonResponse
    {
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']); // عزل الطرف
        $this->assertTenantOwned(Invoice::class, $data['invoice_id'] ?? null, 'الفاتورة');

        $payment = $this->domain(
            fn () => $this->payments->create($data, $data['allocations'] ?? [])
        );

        return (new PaymentResource($payment))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PaymentResource(Payment::with('allocations.allocatable')->findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $payment = Payment::findOrFail($id);
        $posted = $this->domain(fn () => $this->payments->post($payment));

        return (new PaymentResource($posted))->response();
    }
}
