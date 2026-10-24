<?php

namespace App\Http\Controllers\Api;

use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Support\Rbac;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * تسويات بوابات الدفع (PAY-H3-02): القراءة والمعاينة بصلاحية `payments.view`، والتسجيل (`POST /payment-gateway-settlements`) بصلاحية
 * `payment_settlements.manage`؛ كلها معزولة بالمستأجر (معرّف مستأجر آخر ⇒ 404). `POST preview` يحسب المعادلة والفرق (D-21) ولا يكتب شيئاً.
 * التسجيل: فرق صفري ⇒ ترحيل بقيد واحد عبر `LedgerService`؛ فرق غير مفسَّر ⇒ حفظ `unreconciled` بلا قيد. الأخطاء النطاقية ⇒ 422/409 برمز ثابت لا 500.
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

    public function show(Request $request, string $id): JsonResponse
    {
        return response()->json(['data' => $this->detail(PaymentGatewaySettlement::query()->findOrFail($id), $request)]);
    }

    /** @return array<string, mixed> */
    private function detail(PaymentGatewaySettlement $settlement, Request $request): array
    {
        $settlement->loadMissing(['items', 'lines.refund']);
        // هوية الاسترداد (رقمه ومعرّفه) بيانات `payment_refunds.view` (فصل الصلاحيات D-28)؛ بند الاسترداد نفسه (النوع والمبلغ) يخصّ التسوية.
        $seesRefunds = $this->canViewRefunds($request);

        return $this->row($settlement) + [
            'items' => $settlement->items->map(fn ($i) => [
                'payment_id' => $i->payment_id,
                'provider_event_ref' => $i->provider_event_ref,
                'gross_amount' => (int) $i->gross_amount,
            ])->values(),
            'lines' => $settlement->lines->map(fn ($l) => [
                'line_type' => $l->line_type,
                'adjustment_id' => $l->adjustment_id,
                'evidence_ref' => $l->evidence_ref,
                'payment_refund_id' => $seesRefunds ? $l->payment_refund_id : null,
                'refund_number' => $seesRefunds ? $l->refund?->number : null,
                'amount_minor' => (int) $l->amount_minor,
                'provider_event_ref' => $l->provider_event_ref,
            ])->values(),
        ];
    }

    public function unsettled(Request $request, string $gatewayId): JsonResponse
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:200'], 'page' => ['nullable', 'integer', 'min:1', 'max:100000']]);
        PaymentGateway::query()->findOrFail($gatewayId);   // مستأجر آخر ⇒ 404

        $perPage = (int) ($data['per_page'] ?? 100);
        $page = (int) ($data['page'] ?? 1);
        $rows = $this->settlements->unsettledPayments($gatewayId, $perPage, ($page - 1) * $perPage);

        return response()->json([
            'data' => array_slice($rows, 0, $perPage),
            'meta' => ['page' => $page, 'per_page' => $perPage, 'has_more' => count($rows) > $perPage],
        ]);
    }

    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules());
        PaymentGateway::query()->findOrFail($data['payment_gateway_id']);
        if (! empty($data['refunds']) && ! $this->canViewRefunds($request)) {
            return response()->json(['error' => ['code' => 'forbidden', 'message' => 'بنود الاسترداد تتطلب صلاحية عرض استردادات البوابة.']], 403);
        }

        try {
            return response()->json(['data' => $this->settlements->preview($data, $request->user())]);
        } catch (DomainException $e) {
            return $this->rejected($e);
        }
    }

    /** تسجيل التسوية: ترحيل (فرق صفري) أو حفظ `unreconciled` (D-21)؛ إعادة الإرسال بالمرجع نفسه تحدّث المسودة أو تعيد المرحَّلة. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules());
        PaymentGateway::query()->findOrFail($data['payment_gateway_id']);
        // الفاعل من المصادقة لا من الطلب؛ التواريخ الافتراضية من الخادم.
        unset($data['created_by']);
        if (! empty($data['refunds']) && ! $this->canViewRefunds($request)) {
            return response()->json(['error' => ['code' => 'forbidden', 'message' => 'بنود الاسترداد تتطلب صلاحية عرض استردادات البوابة.']], 403);
        }

        try {
            $settlement = $this->settlements->record($data, $request->user());
        } catch (DomainException $e) {
            return $this->rejected($e);
        } catch (\RuntimeException $e) {
            if ($e instanceof QueryException) {
                throw $e;   // أخطاء القاعدة لا تُحوَّل إلى رسالة (قد تحمل SQL)
            }

            return response()->json(['error' => ['code' => 'operation_rejected', 'message' => $e->getMessage()]], 422);
        }

        return response()->json(['data' => $this->detail($settlement, $request)]);
    }

    public function unsettledRefunds(Request $request, string $gatewayId): JsonResponse
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:200'], 'page' => ['nullable', 'integer', 'min:1', 'max:100000']]);
        PaymentGateway::query()->findOrFail($gatewayId);

        $perPage = (int) ($data['per_page'] ?? 100);
        $page = (int) ($data['page'] ?? 1);
        $rows = $this->settlements->unsettledRefunds($gatewayId, $perPage, ($page - 1) * $perPage);

        return response()->json([
            'data' => array_slice($rows, 0, $perPage),
            'meta' => ['page' => $page, 'per_page' => $perPage, 'has_more' => count($rows) > $perPage],
        ]);
    }

    /** @return array<string, list<string>> */
    private function rules(): array
    {
        return [
            'payment_gateway_id' => ['required', 'uuid'],
            'cash_bank_account_id' => ['required', 'uuid'],
            'provider_settlement_ref' => ['required', 'string', 'max:191'],
            'settlement_date' => ['nullable', 'date_format:Y-m-d'],
            'net_bank_amount' => ['required', 'integer', 'min:0', 'max:999999999999'],
            'provider_fee_ex_tax' => ['nullable', 'integer', 'min:0', 'max:999999999999'],
            'provider_fee_tax' => ['nullable', 'integer', 'min:0', 'max:999999999999'],
            'provider_deductions' => ['nullable', 'integer', 'min:0', 'max:999999999999'],
            'provider_credits' => ['nullable', 'integer', 'min:0', 'max:999999999999'],
            'items' => ['nullable', 'array', 'max:200', 'required_without:adjustments'],   // بلا تحصيل: فقط مع تعديل معتمد (تتحقق الخدمة)
            'items.*.payment_id' => ['required', 'uuid'],
            'items.*.gross_amount' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'items.*.provider_event_ref' => ['nullable', 'string', 'max:191'],
            'refunds' => ['nullable', 'array', 'max:100'],
            'refunds.*.payment_refund_id' => ['required', 'uuid'],
            'refunds.*.amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'refunds.*.provider_event_ref' => ['nullable', 'string', 'max:191'],
            'adjustments' => ['nullable', 'array', 'max:50', 'required_without:items'],
            'adjustments.*.adjustment_id' => ['required', 'uuid'],
            'currency' => ['nullable', 'string', 'size:3'],
        ];
    }

    private function canViewRefunds(Request $request): bool
    {
        $user = $request->user();

        return $user !== null && Rbac::allows($user->role, 'payment_refunds.view');
    }

    private function rejected(DomainException $e): JsonResponse
    {
        // الرسائل النطاقية قد تبدأ برمز ثابت «code: ...»؛ غيره `operation_rejected`.
        $code = preg_match('/^([a-z_]+):\s/', $e->getMessage(), $m) === 1 ? $m[1] : 'operation_rejected';
        $status = in_array($code, ['rollout_disabled'], true) ? 409 : 422;

        return response()->json(['error' => ['code' => $code, 'message' => $e->getMessage()]], $status);
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
            'refunds_total' => (int) $s->refunds_total,
            'unreconciled_minor' => $s->unreconciled_minor === null ? null : (int) $s->unreconciled_minor,
            'journal_entry_id' => $s->journal_entry_id,
            'posted_at' => $s->posted_at?->toISOString(),
        ];
    }
}
