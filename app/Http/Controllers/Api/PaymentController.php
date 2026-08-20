<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentRequest;
use App\Http\Resources\PaymentResource;
use App\Models\Account;
use App\Models\Partner;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Purchase;
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
            $this->scopeToActiveBranch($query->with(['partner', 'cashAccount', 'feeExpenseAccount']), $request)->get()
        )->response();
    }

    public function store(StorePaymentRequest $request): JsonResponse
    {
        $data = $request->validated();

        $this->assertReferences($data);

        $payment = $this->domain(
            fn () => $this->payments->create($data, $data['allocations'] ?? [])
        );

        return (new PaymentResource($payment))->response()->setStatusCode(201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new PaymentResource(
            $this->visiblePayment($request, $id)->load(['partner', 'cashAccount', 'feeExpenseAccount', 'paymentMethod', 'allocations.allocatable', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])
        ))->response();
    }

    public function update(StorePaymentRequest $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $data = $request->validated();
        if ($data['direction'] !== $payment->direction) {
            abort(422, 'لا يمكن تغيير اتجاه سند قائم.');
        }
        $this->assertReferences($data);

        $updated = $this->domain(fn () => $this->payments->update($payment, $data, $data['allocations'] ?? []));
        return (new PaymentResource($updated->load(['partner', 'cashAccount', 'feeExpenseAccount', 'paymentMethod', 'allocations.allocatable'])))->response();
    }

    /** النسخة الجديدة مسودة بلا تخصيصات حتى لا تؤثر في فواتير السند الأصل. */
    public function duplicate(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $copy = $this->domain(fn () => $this->payments->duplicate($payment, $request->user()?->id));
        return (new PaymentResource($copy->load(['partner', 'cashAccount', 'feeExpenseAccount', 'paymentMethod', 'allocations.allocatable'])))->response()->setStatusCode(201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        if (! $payment->isDraft()) {
            abort(422, 'لا يمكن حذف سند مرحّل أو ملغى.');
        }

        $this->domain(function () use ($payment) {
            $payment->allocations()->delete();
            $payment->delete();
        });

        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $posted = $this->domain(fn () => $this->payments->post($payment, $request->user()));

        return (new PaymentResource($posted->load(['partner', 'cashAccount', 'feeExpenseAccount', 'paymentMethod', 'allocations.allocatable', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }

    /** سندات القبض مستندات مالية بلا Scope فرع عالمي، فتقيّد كل عملية بالفرع النشط. */
    private function visiblePayment(Request $request, string $id): Payment
    {
        return $this->scopeToActiveBranch(Payment::query(), $request)->whereKey($id)->firstOrFail();
    }

    private function assertReferences(array $data): void
    {
        Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwned(Invoice::class, $data['invoice_id'] ?? null, 'الفاتورة');
        $this->assertTenantOwned(Purchase::class, $data['purchase_id'] ?? null, 'فاتورة المشتريات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwned(PaymentMethod::class, $data['payment_method_id'] ?? null, 'طريقة الدفع');
        foreach ($data['allocations'] ?? [] as $allocation) {
            $this->assertTenantOwned(Invoice::class, $allocation['invoice_id'] ?? null, 'الفاتورة');
            $this->assertTenantOwned(Purchase::class, $allocation['purchase_id'] ?? null, 'فاتورة المشتريات');
        }
    }
}
