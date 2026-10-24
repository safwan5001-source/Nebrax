<?php

namespace App\Http\Controllers\Api;

use App\Models\PaymentGateway;
use App\Services\Accounting\PaymentClearingReportService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * تقارير المقاصة (PAY-H3-03، الحد الأساسي) — قراءة فقط، صلاحية `reports.view`. المطابقة على مستوى المؤسسة وتُحجب عن المستخدم المقيَّد بفروع.
 */
class PaymentClearingReportController extends ApiController
{
    public function __construct(private readonly PaymentClearingReportService $reports)
    {
    }

    public function reconciliation(): JsonResponse
    {
        try {
            return response()->json(['data' => $this->reports->reconcile()]);
        } catch (DomainException $e) {
            return $this->rejected($e);
        }
    }

    private function rejected(DomainException $e): JsonResponse
    {
        $forbidden = str_starts_with($e->getMessage(), 'branch_scope_forbidden');

        return response()->json(['error' => ['code' => $forbidden ? 'branch_scope_forbidden' : 'operation_rejected', 'message' => $e->getMessage()]], $forbidden ? 403 : 422);
    }

    public function differences(Request $request): JsonResponse
    {
        $data = $request->validate(['payment_gateway_id' => ['nullable', 'uuid'], 'limit' => ['nullable', 'integer', 'min:1', 'max:500']]);
        if (! empty($data['payment_gateway_id'])) {
            PaymentGateway::query()->findOrFail($data['payment_gateway_id']);   // مستأجر آخر ⇒ 404
        }

        try {
            return response()->json(['data' => $this->reports->differences($data['payment_gateway_id'] ?? null, (int) ($data['limit'] ?? 200))]);
        } catch (DomainException $e) {
            return $this->rejected($e);
        }
    }

    public function aging(Request $request): JsonResponse
    {
        $data = $request->validate(['branch_id' => ['nullable', 'array', 'max:50'], 'branch_id.*' => ['uuid']]);

        return response()->json(['data' => $this->reports->aging($data)]);
    }
}
