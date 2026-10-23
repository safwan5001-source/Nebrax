<?php

namespace App\Http\Controllers\Api;

use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Services\Accounting\PaymentGatewaySettlementService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * تسويات بوابات الدفع (PAY-H3-02a): **قراءة ومعاينة فقط** بصلاحية `payments.view` ومعزولة بالمستأجر (معرّف مستأجر آخر ⇒ 404).
 * لا ترحيل ولا قيد ولا كتابة هنا: `POST preview` يحسب المعادلة والفرق (D-21) ويشرح ما يمنع الترحيل؛ مسار الترحيل نفسه بعد اعتماد ADR-0008.
 * لا يكشف أسرار البوابة (لا `secret_key` ولا إعداداتها) — أرقام وحالات وتواريخ فقط.
 */
class PaymentGatewaySettlementController extends ApiController
{
    public function __construct(private readonly PaymentGatewaySettlementService $settlements)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'payment_gateway_id' => ['nullable', 'uuid'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $query = PaymentGatewaySettlement::query();
        if (! empty($data['payment_gateway_id'])) {
            $query->where('payment_gateway_id', $data['payment_gateway_id']);
        }
        $page = $query->orderByDesc('settlement_date')->orderByDesc('id')->paginate((int) ($data['per_page'] ?? 25));

        return response()->json([
            'data' => $page->getCollection()->map(fn (PaymentGatewaySettlement $s) => $this->row($s))->values(),
            'meta' => ['total' => $page->total(), 'page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(string $id): JsonResponse
    {
        $settlement = PaymentGatewaySettlement::query()->with('items')->findOrFail($id);

        return response()->json(['data' => $this->row($settlement) + [
            'items' => $settlement->items->map(fn ($i) => [
                'payment_id' => $i->payment_id,
                'provider_event_ref' => $i->provider_event_ref,
                'gross_amount' => (int) $i->gross_amount,
            ])->values(),
        ]]);
    }

    public function unsettled(string $gatewayId): JsonResponse
    {
        PaymentGateway::query()->findOrFail($gatewayId);   // مستأجر آخر ⇒ 404

        return response()->json(['data' => $this->settlements->unsettledPayments($gatewayId)]);
    }

    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'payment_gateway_id' => ['required', 'uuid'],
            'provider_settlement_ref' => ['nullable', 'string', 'max:191'],
            'net_bank_amount' => ['required', 'integer', 'min:0'],
            'provider_fee_ex_tax' => ['nullable', 'integer', 'min:0'],
            'provider_fee_tax' => ['nullable', 'integer', 'min:0'],
            'provider_deductions' => ['nullable', 'integer', 'min:0'],
            'provider_credits' => ['nullable', 'integer', 'min:0'],
            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*.payment_id' => ['required', 'uuid'],
            'items.*.gross_amount' => ['required', 'integer', 'min:1'],
            'items.*.provider_event_ref' => ['nullable', 'string', 'max:191'],
        ]);
        PaymentGateway::query()->findOrFail($data['payment_gateway_id']);

        try {
            return response()->json(['data' => $this->settlements->preview($data)]);
        } catch (DomainException $e) {
            return response()->json(['error' => ['code' => 'operation_rejected', 'message' => $e->getMessage()]], 422);
        }
    }

    /** @return array<string, mixed> */
    private function row(PaymentGatewaySettlement $s): array
    {
        return [
            'id' => $s->id,
            'payment_gateway_id' => $s->payment_gateway_id,
            'gateway_name' => $s->gateway_name,
            'provider_settlement_ref' => $s->provider_settlement_ref,
            'settlement_date' => $s->settlement_date?->toDateString(),
            'status' => $s->status,
            'currency' => $s->currency,
            'gross_amount' => (int) $s->gross_amount,
            'net_bank_amount' => (int) $s->net_bank_amount,
            'provider_fee_ex_tax' => (int) $s->provider_fee_ex_tax,
            'provider_fee_tax' => (int) $s->provider_fee_tax,
            'provider_deductions' => (int) $s->provider_deductions,
            'provider_credits' => (int) $s->provider_credits,
            'journal_entry_id' => $s->journal_entry_id,
            'posted_at' => $s->posted_at?->toISOString(),
        ];
    }
}
