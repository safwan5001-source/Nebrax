<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentRequest;
use App\Http\Requests\UpdateDocumentClassificationRequest;
use App\Http\Resources\PaymentResource;
use App\Models\Account;
use App\Models\Employee;
use App\Models\Partner;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Purchase;
use App\Services\Accounting\PaymentService;
use App\Services\ClassificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PaymentController extends ApiController
{
    public function __construct(
        protected PaymentService $payments,
        protected ClassificationService $classifications,
    ) {}

    /**
     * قائمة موحّدة للقبض والصرف. `direction` يبقى عقد الفصل بين الشاشتين،
     * بينما بقية Data Explorer تُنفَّذ في SQL مع توافق رجعي عند غياب pagination.
     */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'direction' => ['sometimes', 'nullable', 'in:received,paid'],
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', 'in:draft,posted,cancelled'],
            'method' => ['sometimes', 'nullable', 'string', 'max:60'],
            'partner_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date'],
            'amount_min' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'amount_max' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
        ]);

        $query = $this->scopeToActiveBranch(
            Payment::with(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments']),
            $request
        );

        if (filled($filters['direction'] ?? null)) $query->where('direction', $filters['direction']);

        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $like = "%{$needle}%";
            $query->where(function ($search) use ($like): void {
                $search->where('number', 'like', $like)
                    ->orWhere('reference', 'like', $like)
                    ->orWhere('payment_method_name', 'like', $like)
                    ->orWhere('method', 'like', $like)
                    ->orWhere('notes', 'like', $like)
                    ->orWhereHas('partner', fn ($partner) => $partner->where('name', 'like', $like));
            });
        }

        if (filled($filters['status'] ?? null)) $query->where('status', $filters['status']);
        if (filled($filters['method'] ?? null)) $query->where('method', $filters['method']);
        if (filled($filters['partner_name'] ?? null)) {
            $query->whereHas('partner', fn ($partner) => $partner->where('name', $filters['partner_name']));
        }
        if (filled($filters['date_from'] ?? null)) $query->whereDate('payment_date', '>=', $filters['date_from']);
        if (filled($filters['date_to'] ?? null)) $query->whereDate('payment_date', '<=', $filters['date_to']);
        if (filled($filters['amount_min'] ?? null)) $query->where('amount', '>=', $this->moneyFilterToMinor((string) $filters['amount_min']));
        if (filled($filters['amount_max'] ?? null)) $query->where('amount', '<=', $this->moneyFilterToMinor((string) $filters['amount_max']));

        $paginated = isset($filters['per_page']);
        $sort = (string) ($filters['sort'] ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $sortKey = ltrim($sort, '-');

        if ($sortKey === 'partner_name' && $sort !== '') {
            $query->orderBy(Partner::select('name')->whereColumn('partners.id', 'payments.partner_id'), $direction)->orderByDesc('id');
        } elseif (in_array($sortKey, ['payment_date', 'number', 'amount', 'created_at'], true) && $sort !== '') {
            $query->orderBy($sortKey, $direction)->orderByDesc('id');
        } elseif ($paginated) {
            $query->orderByDesc('payment_date')->orderByDesc('id');
        } else {
            $query->latest();
        }

        if ($paginated) {
            return PaymentResource::collection(
                $query->paginate((int) $filters['per_page'])->withQueryString()
            )->response();
        }

        return PaymentResource::collection($query->get())->response();
    }

    public function store(StorePaymentRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['created_by'] = $request->user()?->id;
        if (! array_key_exists('collector_employee_id', $data) && $request->user()?->employee_id) {
            $data['collector_employee_id'] = $request->user()->employee_id;
        }
        $this->assertReferences($data);

        $payment = $this->domain(fn () => $this->payments->create($data, $data['allocations'] ?? []));
        $this->storeAttachments($request, $payment);

        return (new PaymentResource($payment->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments'])))->response()->setStatusCode(201);
    }

    public function collectors(): JsonResponse
    {
        return response()->json([
            'data' => Employee::query()->where('is_active', true)->orderBy('name')->get(['id', 'employee_no', 'name']),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new PaymentResource(
            $this->visiblePayment($request, $id)->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])
        ))->response();
    }

    public function update(StorePaymentRequest $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $data = $request->validated();
        if ($data['direction'] !== $payment->direction) abort(422, 'لا يمكن تغيير اتجاه سند قائم.');
        $this->assertReferences($data);
        $updated = $this->domain(fn () => $this->payments->update($payment, $data, $data['allocations'] ?? []));
        $this->storeAttachments($request, $updated);
        return (new PaymentResource($updated->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable'])))->response();
    }

    public function updateClassification(UpdateDocumentClassificationRequest $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $scope = $payment->direction === 'received' ? 'receipt' : 'payment';
        $updated = $this->domain(fn () => $this->classifications->updateDocumentClassification(
            $payment,
            $request->validated('classification_id'),
            $scope,
        ));
        return (new PaymentResource($updated->load(['classification', 'partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments'])))->response();
    }

    public function duplicate(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $copy = $this->domain(fn () => $this->payments->duplicate($payment, $request->user()?->id));
        return (new PaymentResource($copy->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable'])))->response()->setStatusCode(201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        if (! $payment->isDraft()) abort(422, 'لا يمكن حذف سند مرحّل أو ملغى.');
        $attachments = $payment->attachments()->get();
        $this->domain(function () use ($payment) {
            $payment->allocations()->delete();
            $payment->attachments()->delete();
            $payment->delete();
        });
        foreach ($attachments as $attachment) Storage::disk($attachment->disk)->delete($attachment->path);
        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $posted = $this->domain(fn () => $this->payments->post($payment, $request->user()));
        return (new PaymentResource($posted->load(['partner', 'cashAccount', 'paymentMethod', 'collectorEmployee', 'attachments', 'allocations.allocatable', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }

    public function downloadAttachment(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $payment = $this->visiblePayment($request, $id);
        $attachment = $payment->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = Storage::disk($attachment->disk);
        if (! $disk->exists($attachment->path)) abort(404, 'ملف المرفق غير موجود.');
        return $disk->download($attachment->path, $attachment->original_name, ['Content-Type' => $attachment->mime_type ?? 'application/octet-stream']);
    }

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

    private function storeAttachments(StorePaymentRequest $request, Payment $payment): void
    {
        foreach ($request->file('attachments', []) as $file) {
            $path = $file->store("payments/{$payment->id}", 'local');
            $payment->attachments()->create([
                'disk' => 'local',
                'path' => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime_type' => $file->getMimeType(),
                'size' => $file->getSize(),
                'uploaded_by' => $request->user()?->id,
            ]);
        }
    }

    private function moneyFilterToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);
        return ((int) $whole * 100) + (int) $fraction;
    }
}
