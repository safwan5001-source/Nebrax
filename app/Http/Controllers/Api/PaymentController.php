<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentRequest;
use App\Http\Resources\PaymentResource;
use App\Models\Account;
use App\Models\Employee;
use App\Models\Partner;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Purchase;
use App\Services\Accounting\PaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

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
            $this->scopeToActiveBranch($query->with(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments']), $request)->get()
        )->response();
    }

    public function store(StorePaymentRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['created_by'] = $request->user()?->id;
        // المحصّل الافتراضي هو موظف المستخدم الحالي إن كان حسابه مرتبطاً بموظف.
        if (! array_key_exists('collector_employee_id', $data) && $request->user()?->employee_id) {
            $data['collector_employee_id'] = $request->user()->employee_id;
        }
        $this->assertReferences($data);

        $payment = $this->domain(
            fn () => $this->payments->create($data, $data['allocations'] ?? [])
        );
        $this->storeAttachments($request, $payment);

        return (new PaymentResource($payment->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments'])))->response()->setStatusCode(201);
    }

    /** موظفو التحصيل النشطون؛ حمولة مختصرة لا تتضمن بيانات موارد بشرية حساسة. */
    public function collectors(): JsonResponse
    {
        return response()->json([
            'data' => Employee::query()
                ->where('is_active', true)
                ->orderBy('name')
                ->get(['id', 'employee_no', 'name']),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new PaymentResource(
            $this->visiblePayment($request, $id)->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])
        ))->response();
    }

    /** تعديل مسودة السند؛ يحافظ غياب حقل المحصّل على قيمته الحالية داخل الخدمة. */
    public function update(StorePaymentRequest $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $data = $request->validated();
        if ($data['direction'] !== $payment->direction) {
            abort(422, 'لا يمكن تغيير اتجاه سند قائم.');
        }
        $this->assertReferences($data);

        $updated = $this->domain(fn () => $this->payments->update($payment, $data, $data['allocations'] ?? []));
        $this->storeAttachments($request, $updated);

        return (new PaymentResource($updated->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable'])))->response();
    }

    /** النسخة الجديدة مسودة بلا تخصيصات ولا مرفقات كي لا تكرر حجوزات أو إثباتات المصدر. */
    public function duplicate(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $copy = $this->domain(fn () => $this->payments->duplicate($payment, $request->user()?->id));
        return (new PaymentResource($copy->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable'])))->response()->setStatusCode(201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        if (! $payment->isDraft()) {
            abort(422, 'لا يمكن حذف سند مرحّل أو ملغى.');
        }

        $attachments = $payment->attachments()->get();
        $this->domain(function () use ($payment) {
            $payment->allocations()->delete();
            $payment->attachments()->delete();
            $payment->delete();
        });

        foreach ($attachments as $attachment) {
            Storage::disk($attachment->disk)->delete($attachment->path);
        }

        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $posted = $this->domain(fn () => $this->payments->post($payment, $request->user()));

        return (new PaymentResource($posted->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }

    /** تنزيل مرفق خاص بعد إثبات أنه يعود لسند مرئي في الفرع النشط. */
    public function downloadAttachment(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $attachment = $payment->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = Storage::disk($attachment->disk);

        if (! $disk->exists($attachment->path)) {
            abort(404, 'ملف المرفق غير موجود.');
        }

        return $disk->download($attachment->path, $attachment->original_name, [
            'Content-Type' => $attachment->mime_type ?? 'application/octet-stream',
        ]);
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
        if (! empty($data['collector_employee_id'])) {
            Employee::whereKey($data['collector_employee_id'])->where('is_active', true)->firstOrFail();
        }
        foreach ($data['allocations'] ?? [] as $allocation) {
            $this->assertTenantOwned(Invoice::class, $allocation['invoice_id'] ?? null, 'الفاتورة');
            $this->assertTenantOwned(Purchase::class, $allocation['purchase_id'] ?? null, 'فاتورة المشتريات');
        }
    }

    /**
     * تُحفَظ الملفات على قرص خاص وتُربط بالسند الذي أنشأه الخادم فقط؛ لا يقبل
     * الطلب مساراً جاهزاً، فلا يمكن ربط سند بملف يخص مستأجراً أو وثيقة أخرى.
     */
    private function storeAttachments(StorePaymentRequest $request, Payment $payment): void
    {
        foreach ($request->file('attachments', []) as $file) {
            $path = $file->store("payments/{$payment->id}", 'local');

            $payment->attachments()->create([
                'disk'          => 'local',
                'path'          => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime_type'     => $file->getMimeType(),
                'size'          => $file->getSize(),
                'uploaded_by'   => $request->user()?->id,
            ]);
        }
    }
}
