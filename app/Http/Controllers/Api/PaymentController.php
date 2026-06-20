<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentRequest;
use App\Http\Resources\PaymentResource;
use App\Models\Partner;
use App\Models\Payment;
use App\Services\Accounting\PaymentService;
use Illuminate\Http\JsonResponse;

class PaymentController extends ApiController
{
    public function __construct(protected PaymentService $payments) {}

    public function index(): JsonResponse
    {
        return PaymentResource::collection(Payment::latest()->get())->response();
    }

    public function store(StorePaymentRequest $request): JsonResponse
    {
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']); // عزل الطرف

        $payment = $this->domain(
            fn () => $this->payments->create($data, $data['allocations'] ?? [])
        );

        return (new PaymentResource($payment))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PaymentResource(Payment::findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $payment = Payment::findOrFail($id);
        $posted = $this->domain(fn () => $this->payments->post($payment));

        return (new PaymentResource($posted))->response();
    }
}
