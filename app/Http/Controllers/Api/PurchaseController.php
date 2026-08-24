<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePurchaseAttachmentsRequest;
use App\Http\Requests\StorePurchaseRequest;
use App\Http\Requests\UpdateDocumentClassificationRequest;
use App\Http\Resources\PurchaseResource;
use App\Models\CostCenter;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseAttachment;
use App\Models\StockMovement;
use App\Services\Accounting\PurchaseRelationsService;
use App\Services\Accounting\PurchaseService;
use App\Services\ClassificationService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PurchaseController extends ApiController
{
    public function __construct(
        protected PurchaseService $purchases,
        protected PurchaseRelationsService $relations,
        protected ClassificationService $classifications,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', 'in:draft,posted,cancelled'],
            'payment_status' => ['sometimes', 'nullable', 'in:unpaid,partial,paid'],
            'partner_id' => ['sometimes', 'nullable', 'uuid'],
            'classification_id' => ['sometimes', 'nullable', 'uuid'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date', 'after_or_equal:date_from'],
            'due_from' => ['sometimes', 'nullable', 'date'],
            'due_to' => ['sometimes', 'nullable', 'date', 'after_or_equal:due_from'],
            'total_gte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'total_lte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'remaining_gte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'remaining_lte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
        ]);

        $query = $this->scopeToActiveBranch(
            Purchase::with(['lines', 'classification']),
            $request,
        );

        if ($search = trim((string) ($filters['search'] ?? ''))) {
            $escaped = addcslashes($search, '%_\\');
            $query->where(function ($builder) use ($escaped) {
                $builder
                    ->where('number', 'like', "%{$escaped}%")
                    ->orWhere('supplier_invoice_no', 'like', "%{$escaped}%")
                    ->orWhereHas('partner', function ($partner) use ($escaped) {
                        $partner
                            ->where('name', 'like', "%{$escaped}%")
                            ->orWhere('phone', 'like', "%{$escaped}%")
                            ->orWhere('vat_number', 'like', "%{$escaped}%");
                    });
            });
        }

        foreach (['status', 'payment_status', 'partner_id', 'classification_id'] as $key) {
            if (! empty($filters[$key])) {
                $query->where($key, $filters[$key]);
            }
        }

        if (! empty($filters['date_from'])) $query->whereDate('purchase_date', '>=', $filters['date_from']);
        if (! empty($filters['date_to'])) $query->whereDate('purchase_date', '<=', $filters['date_to']);
        if (! empty($filters['due_from'])) $query->whereDate('due_date', '>=', $filters['due_from']);
        if (! empty($filters['due_to'])) $query->whereDate('due_date', '<=', $filters['due_to']);

        if (isset($filters['total_gte'])) $query->where('total', '>=', $this->moneyFilterToMinor((string) $filters['total_gte']));
        if (isset($filters['total_lte'])) $query->where('total', '<=', $this->moneyFilterToMinor((string) $filters['total_lte']));
        if (isset($filters['remaining_gte'])) {
            $query->whereRaw('(total - paid_amount) >= ?', [$this->moneyFilterToMinor((string) $filters['remaining_gte'])]);
        }
        if (isset($filters['remaining_lte'])) {
            $query->whereRaw('(total - paid_amount) <= ?', [$this->moneyFilterToMinor((string) $filters['remaining_lte'])]);
        }

        $sort = (string) ($filters['sort'] ?? '-purchase_date');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $field = ltrim($sort, '-');
        $sortable = ['number', 'purchase_date', 'due_date', 'total', 'created_at'];

        if ($field === 'remaining') {
            $query->orderByRaw("(total - paid_amount) {$direction}");
        } elseif (in_array($field, $sortable, true)) {
            $query->orderBy($field, $direction);
        } else {
            $query->orderByDesc('purchase_date');
        }
        $query->orderByDesc('id');

        if (isset($filters['per_page'])) {
            return PurchaseResource::collection($query->paginate((int) $filters['per_page'])->withQueryString())->response();
        }

        // توافق رجعي: الاستدعاءات القديمة التي لا تطلب pagination تستمر بالقائمة المعتادة.
        return PurchaseResource::collection($query->get())->response();
    }

    public function store(StorePurchaseRequest $request): JsonResponse
    {
        $data = $request->validated();
        // مصدر التقرير هو المستخدم الموثق، لا قيمة يرسلها العميل ويستطيع انتحالها.
        $data['created_by'] = $request->user()?->id;

        Partner::findOrFail($data['partner_id']); // عزل المورد
        $this->assertWarehouseAllowed($data['warehouse_id'] ?? null, $this->activeBranchId());
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $purchase = $this->domain(fn () => $this->purchases->create($data, $data['items']));

        return (new PurchaseResource($purchase->load('lines')))->response()->setStatusCode(201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new PurchaseResource($this->visiblePurchase($request, $id)->load(['lines', 'attachments', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }

    /** قائمة مرفقات فاتورة المورد ضمن نطاق الفرع المسموح. */
    public function indexAttachments(Request $request, string $id): JsonResponse
    {
        $purchase = $this->visiblePurchase($request, $id);

        return response()->json(['data' => $this->attachmentPayload($purchase)]);
    }

    /** تُرفع المرفقات بعد إنشاء الفاتورة كي ترتبط بمعرف مصدر موثوق فقط. */
    public function storeAttachments(StorePurchaseAttachmentsRequest $request, string $id): JsonResponse
    {
        $purchase = $this->visiblePurchase($request, $id);
        $this->persistAttachments($request, $purchase);

        return response()->json(['data' => $this->attachmentPayload($purchase)], 201);
    }

    /** تنزيل خاص بعد إثبات أن المرفق يعود لفاتورة مرئية للمستخدم. */
    public function downloadAttachment(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $purchase = $this->visiblePurchase($request, $id);
        $attachment = $purchase->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = Storage::disk($attachment->disk);

        if (! $disk->exists($attachment->path)) {
            abort(404, 'ملف المرفق غير موجود.');
        }

        return $disk->download($attachment->path, $attachment->original_name, [
            'Content-Type' => $attachment->mime_type ?? 'application/octet-stream',
        ]);
    }

    /** حذف مرفق مسودة فقط، مع تنظيف الملف الخاص من القرص. */
    public function destroyAttachment(Request $request, string $id, string $attachmentId): JsonResponse
    {
        $purchase = $this->visiblePurchase($request, $id);
        if (! $purchase->isDraft()) {
            abort(422, 'لا يمكن حذف مرفق من فاتورة مشتريات مرحّلة.');
        }

        $attachment = $purchase->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = $attachment->disk;
        $path = $attachment->path;
        $attachment->delete();
        Storage::disk($disk)->delete($path);

        return response()->json(['message' => 'تم حذف المرفق.']);
    }

    /** سندات الصرف المرتبطة بالشراء للقراءة؛ التخصيص لا مبلغ السند الكلي هو المعروض. */
    public function payments(Request $request, string $id): JsonResponse
    {
        $purchase = $this->visiblePurchase($request, $id);

        return response()->json([
            'data' => $this->relations->payments(
                $purchase,
                $this->scopeToActiveBranch(Payment::query(), $request),
            ),
        ]);
    }

    /** قيد شراء المصدر للقراءة فقط؛ المسار محمي بصلاحية التقارير. */
    public function accounting(Request $request, string $id): JsonResponse
    {
        return response()->json(['data' => $this->relations->accountingLinks($this->visiblePurchase($request, $id))]);
    }

    /** حركات الاستلام التي أنشأها ترحيل الشراء فعلياً؛ لا تُستنتج من السطور. */
    public function inventory(Request $request, string $id): JsonResponse
    {
        $purchase = $this->visiblePurchase($request, $id);
        $rows = $this->scopeToActiveBranch(StockMovement::with(['product', 'warehouse']), $request)
            ->where('source_type', Purchase::class)
            ->where('source_id', $purchase->id)
            ->orderByDesc('movement_date')
            ->orderByDesc('id')
            ->get()
            ->map(fn (StockMovement $movement) => [
                'id'               => $movement->id,
                'type'             => $movement->type,
                'movement_date'    => optional($movement->movement_date)->toDateString(),
                'quantity'         => $movement->quantity,
                'unit_cost'        => Money::toRiyal($movement->unit_cost),
                'total_cost'       => Money::toRiyal($movement->total_cost),
                'balance_quantity' => $movement->balance_quantity,
                'notes'            => $movement->notes,
                'product'          => $movement->product ? [
                    'id'   => $movement->product->id,
                    'sku'  => $movement->product->sku,
                    'name' => $movement->product->name,
                    'unit' => $movement->product->unit,
                ] : null,
                'warehouse'        => $movement->warehouse ? [
                    'id'   => $movement->warehouse->id,
                    'code' => $movement->warehouse->code,
                    'name' => $movement->warehouse->name,
                ] : null,
            ])->values();

        return response()->json(['data' => $rows]);
    }

    /**
     * تعديل مسوّدة. المرحّلة `immutable` ويرفضها `PurchaseService::update`
     * — التحقق في الخدمة لا هنا، فلا يتسرّب مسارٌ يتجاوزه.
     */
    public function update(StorePurchaseRequest $request, string $id): JsonResponse
    {
        $purchase = Purchase::findOrFail($id); // عزل تلقائي بالمستأجر
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']);
        $this->assertWarehouseAllowed($data['warehouse_id'] ?? null, $purchase->branch_id);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $updated = $this->domain(fn () => $this->purchases->update($purchase, $data, $data['items']));

        return (new PurchaseResource($updated->load('lines')))->response();
    }

    /** تنشئ نسخة مسودة برقم جديد بلا مرفقات أو مدفوعات أو أثر محاسبي أو مخزني. */
    public function duplicate(Request $request, string $id): JsonResponse
    {
        $purchase = $this->visiblePurchase($request, $id);
        $copy = $this->domain(fn () => $this->purchases->duplicate($purchase, $request->user()?->id));

        return (new PurchaseResource($copy->load(['lines', 'attachments'])))->response()->setStatusCode(201);
    }

    /** تعديل تحليلي محدود؛ لا يفتح تعديل مبلغ أو بنود أو قيد شراء مرحّل. */
    public function updateClassification(UpdateDocumentClassificationRequest $request, string $id): JsonResponse
    {
        $purchase = Purchase::findOrFail($id);
        $updated = $this->domain(fn () => $this->classifications->updateDocumentClassification(
            $purchase,
            $request->validated('classification_id'),
            'purchase_invoice',
        ));

        return (new PurchaseResource($updated->load(['classification', 'lines'])))->response();
    }

    /** حذف مسوّدة. المرحّلة لا تُحذف — سلامة الأثر المحاسبي. */
    public function destroy(string $id): JsonResponse
    {
        $purchase = Purchase::findOrFail($id);
        $attachments = $purchase->attachments()->get();
        $this->domain(fn () => $this->purchases->deleteDraft($purchase));

        foreach ($attachments as $attachment) {
            Storage::disk($attachment->disk)->delete($attachment->path);
        }

        return response()->json(['message' => 'تم الحذف.']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $purchase = Purchase::findOrFail($id);
        $this->assertWarehouseAllowed($purchase->warehouse_id, $purchase->branch_id);
        $posted = $this->domain(fn () => $this->purchases->post($purchase));

        return (new PurchaseResource($posted->load(['lines', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }

    /** @return array<int, array{id: string, original_name: string, mime_type: string|null, size: int, created_at: string|null}> */
    private function attachmentPayload(Purchase $purchase): array
    {
        return $purchase->attachments()->latest()->get()->map(fn (PurchaseAttachment $attachment) => [
            'id' => $attachment->id,
            'original_name' => $attachment->original_name,
            'mime_type' => $attachment->mime_type,
            'size' => (int) $attachment->size,
            'created_at' => optional($attachment->created_at)->toIso8601String(),
        ])->all();
    }

    private function persistAttachments(StorePurchaseAttachmentsRequest $request, Purchase $purchase): void
    {
        foreach ($request->file('attachments', []) as $file) {
            $path = $file->store("purchases/{$purchase->id}", 'local');

            $purchase->attachments()->create([
                'disk' => 'local',
                'path' => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime_type' => $file->getMimeType(),
                'size' => $file->getSize(),
                'uploaded_by' => $request->user()?->id,
            ]);
        }
    }

    private function visiblePurchase(Request $request, string $id): Purchase
    {
        return $this->scopeToActiveBranch(Purchase::query(), $request)->findOrFail($id);
    }

    private function moneyFilterToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);

        return ((int) $whole * 100) + (int) $fraction;
    }
}
