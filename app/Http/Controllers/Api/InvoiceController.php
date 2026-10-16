<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreInvoiceNoteRequest;
use App\Http\Requests\StoreInvoiceRequest;
use App\Http\Requests\UpdateDocumentClassificationRequest;
use App\Http\Resources\InvoiceNoteResource;
use App\Http\Resources\InvoiceResource;
use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Employee;
use App\Models\Invoice;
use App\Models\InvoiceNote;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\PriceList;
use App\Models\StockMovement;
use App\Support\ConcurrencyConflict;
use App\Support\Money;
use App\Services\Accounting\InvoiceRelationsService;
use App\Services\Accounting\InvoiceService;
use App\Services\AttachmentStorage;
use App\Services\ClassificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PDOException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class InvoiceController extends ApiController
{
    public function __construct(
        protected InvoiceService $invoices,
        protected InvoiceRelationsService $relations,
        protected ClassificationService $classifications,
        protected AttachmentStorage $attachmentStorage,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', 'in:draft,posted,cancelled'],
            'payment_status' => ['sometimes', 'nullable', 'in:unpaid,partial,paid'],
            'partner_id' => ['sometimes', 'nullable', 'uuid'],
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
            Invoice::with('priceList', 'lines.product', 'lines.costCenterAllocations.costCenter'),
            $request,
        );

        if ($search = trim((string) ($filters['search'] ?? ''))) {
            $escaped = addcslashes($search, '%_\\');
            $query->where(function ($builder) use ($escaped) {
                $builder
                    ->where('number', 'like', "%{$escaped}%")
                    ->orWhere('payment_reference', 'like', "%{$escaped}%")
                    ->orWhereHas('partner', fn ($partner) => $partner->where('name', 'like', "%{$escaped}%"));
            });
        }

        foreach (['status', 'payment_status', 'partner_id'] as $key) {
            if (! empty($filters[$key])) {
                $query->where($key, $filters[$key]);
            }
        }

        if (! empty($filters['date_from'])) $query->whereDate('invoice_date', '>=', $filters['date_from']);
        if (! empty($filters['date_to'])) $query->whereDate('invoice_date', '<=', $filters['date_to']);
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

        $sort = (string) ($filters['sort'] ?? '-invoice_date');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $field = ltrim($sort, '-');
        $sortable = ['number', 'invoice_date', 'due_date', 'total', 'created_at'];

        if ($field === 'remaining') {
            $query->orderByRaw("(total - paid_amount) {$direction}");
        } elseif (in_array($field, $sortable, true)) {
            $query->orderBy($field, $direction);
        } else {
            $query->orderByDesc('invoice_date');
        }
        $query->orderByDesc('id');

        if (isset($filters['per_page'])) {
            return InvoiceResource::collection($query->paginate((int) $filters['per_page'])->withQueryString())->response();
        }

        // توافق رجعي: الاستدعاءات القديمة التي لا تطلب pagination تستمر بالقائمة المعتادة.
        return InvoiceResource::collection($query->get())->response();
    }

    public function store(StoreInvoiceRequest $request): JsonResponse
    {
        $data = $request->validated();
        // يحقن الخادم الفاعل؛ لا يقبل الطلب معرّف اعتماد أو منشئ من العميل.
        $data['created_by'] = $request->user()?->id;
        $data['minimum_price_override_actor_id'] = $request->user()?->id;

        // عزل: كل المراجع يجب أن تخص المستأجر الحالي (تصدّ حقن معرّفات مستأجرين آخرين)
        Partner::findOrFail($data['partner_id']);
        $this->assertWarehouseAllowed($data['warehouse_id'] ?? null, $this->activeBranchId(), false);
        $this->assertSelectablePriceList($data['price_list_id'] ?? null);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $invoice = $this->domain(fn () => $this->invoices->create($data, $data['items']));

        return (new InvoiceResource($invoice->load('priceList', 'lines.product', 'lines.costCenterAllocations.costCenter', 'printTemplateOverrideRevision', 'pdfTemplateOverrideRevision')))->response()->setStatusCode(201);
    }

    /**
     * R3: الوصول المباشر بمعرّف — بما فيه إعادة طباعة/عرض إيصال POS من قائمة
     * الفواتير الأخيرة — يجب أن يحترم الفرع النشط تماماً كباقي قراءات
     * الفاتورة (`payments`/`accounting`/`inventory`/`notes`/`zatca` عبر
     * `visibleInvoice()` أدناه). معرفة UUID وحدها لم تعد تكفي لتجاوز فرعٍ لا
     * يملك المستخدم صلاحيته — غير المقيَّد (`allowedBranchIds() === null`)
     * يبقى يرى كل شيء، فلا ينكسر أي تدفّق ERP عابر للفروع مصرَّح به فعلاً.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        // PR-4: `partner` لم تكن محمَّلة هنا فتغيب من الاستجابة (`InvoiceResource`
        // تستعمل `whenLoaded`) رغم أن الحقل معرَّف في العقد أصلاً — فجوة كانت
        // تُسقط اسم العميل من إعادة طباعة الإيصال ومركز الفواتير في نقطة البيع
        // (كلاهما يستهلك هذا المسار نفسه). إضافة العلاقة هنا تُكمل عقداً قائماً
        // بلا تغيير في الشكل ولا سلوك مالي.
        $invoice = $this->scopeToActiveBranch(Invoice::with([
            'partner:id,name,vat_number,city',
            'priceList', 'lines.product', 'lines.costCenterAllocations.costCenter', 'costCenter', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision',
            'printTemplateOverrideRevision', 'pdfTemplateOverrideRevision',
            'deliveryNoteAllocations.deliveryNote', 'deliveryNoteAllocations.lineLinks',
        ]), $request)->findOrFail($id);

        // REM-14c: القراءة المفردة وحدها تكشف كتلة `parties` (لقطة لحظة الإصدار) — ضمن صلاحية invoices.view
        // ونطاق الفرع القائمين نفسيهما؛ القوائم لا تحملها.
        return (new InvoiceResource($invoice))->withParties()->response();
    }

    /** مدفوعات الفاتورة للقراءة: مبلغ التخصيص لا مبلغ سند قد يغطي فواتير أخرى. */
    public function payments(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);

        return response()->json([
            'data' => $this->relations->payments(
                $invoice,
                $this->scopeToActiveBranch(Payment::query(), $request),
            ),
        ]);
    }

    /** روابط القيد وقيد التكلفة للقراءة، محمية بصلاحية التقارير في المسار. */
    public function accounting(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);

        return response()->json(['data' => $this->relations->accountingLinks($invoice)]);
    }

    /**
     * حركات مخزون ولّدها ترحيل الفاتورة فعلياً. لا نستنتج حركة من سطور الفاتورة
     * ولا نعرض إذناً منفصلاً غير موجود في نبراكس؛ المصدر المحفوظ هو الحقيقة.
     */
    public function inventory(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);
        $rows = StockMovement::with(['product', 'warehouse'])
            ->where('source_type', Invoice::class)
            ->where('source_id', $invoice->id)
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

    /** سجل الملاحظات الداخلي للفواتير؛ قراءة فقط ولا يعيد تفسير الفاتورة المحاسبية. */
    public function notes(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);

        return InvoiceNoteResource::collection($invoice->notesLog()->with('attachments')->get())->response();
    }

    /** ينشئ ملاحظة داخلية وملفات خاصة مرتبطة بها، من دون تعديل حالة الفاتورة أو قيدها. */
    public function storeNote(StoreInvoiceNoteRequest $request, string $id): JsonResponse
    {
        // REM-03b: كتابة ملاحظة/مرفقات = عملية تغييرية ⇒ الفرع النشط فقط، قبل توليد
        // معرّف المورد وقبل تخزين أي ملف أو صف (القراءة `notes()` تبقى على سياسة القراءة).
        $invoice = $this->targetInvoice($id);
        $data = $request->validated();

        // ذرّية الطلب (Q12): الملفات أولاً خارج المعاملة، ثم الملاحظة وصفوف مرفقاتها معاً.
        // فشل أي ملف لا يُبقي ملاحظةً ولا صفاً ولا كائناً، فإعادة المحاولة لا تُكرّر ملاحظة.
        $resourceId = $this->attachmentStorage->newResourceId();
        $stored = $this->attachmentStorage->putMany(
            AttachmentStorage::DOMAIN_INVOICE_NOTE,
            $resourceId,
            $request->file('attachments', []),
            "invoices/{$invoice->id}/notes/{$resourceId}",
        );

        try {
            $note = DB::transaction(function () use ($invoice, $data, $request, $stored) {
                $note = $invoice->notesLog()->create([
                    'recorded_at' => $data['recorded_at'] ?? now(),
                    'body'        => $data['body'] ?? null,
                    'created_by'  => $request->user()?->id,
                ]);
                foreach ($stored as $file) {
                    $note->attachments()->create($file + ['uploaded_by' => $request->user()?->id]);
                }

                return $note;
            });
        } catch (\Throwable $e) {
            $this->attachmentStorage->discard($stored);
            throw $e;
        }

        return (new InvoiceNoteResource($note->load('attachments')))->response()->setStatusCode(201);
    }

    /** تنزيل ملف خاص بعد إثبات أنه ينتمي لملاحظة فاتورة مرئية في الفرع النشط. */
    public function downloadNoteAttachment(Request $request, string $id, string $noteId, string $attachmentId): StreamedResponse
    {
        $invoice = $this->visibleInvoice($request, $id);
        $note = $invoice->notesLog()->whereKey($noteId)->firstOrFail();
        $attachment = $note->attachments()->whereKey($attachmentId)->firstOrFail();

        return $this->attachmentStorage->download(
            $attachment->disk, $attachment->path, $attachment->original_name, $attachment->mime_type,
        );
    }

    /**
     * تعديل فاتورة مسوّدة (draft فقط) — نفس تحقّق المراجع في store.
     * المرحّلة immutable؛ الخدمة ترفضها (422).
     */
    public function update(StoreInvoiceRequest $request, string $id): JsonResponse
    {
        $invoice = $this->targetInvoice($id); // REM-03: الفرع النشط فقط (فوق عزل المستأجر)
        $data = $request->validated();
        $data['minimum_price_override_actor_id'] = $request->user()?->id;

        Partner::findOrFail($data['partner_id']);
        $this->assertWarehouseAllowed($data['warehouse_id'] ?? null, $invoice->branch_id, false);
        if (array_key_exists('price_list_id', $data)) {
            $this->assertSelectablePriceList($data['price_list_id'], $invoice->price_list_id);
        }
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $updated = $this->domain(fn () => $this->invoices->update($invoice, $data, $data['items']));

        return (new InvoiceResource($updated->load('priceList', 'lines.product', 'lines.costCenterAllocations.costCenter', 'printTemplateOverrideRevision', 'pdfTemplateOverrideRevision')))->response();
    }

    /**
     * تعديل تحليلي محدود؛ لا يفتح تعديل المبالغ أو البنود أو القيد بعد الترحيل.
     */
    public function updateClassification(UpdateDocumentClassificationRequest $request, string $id): JsonResponse
    {
        $invoice = $this->targetInvoice($id);
        $updated = $this->domain(fn () => $this->classifications->updateDocumentClassification(
            $invoice,
            $request->validated('classification_id'),
            'sales_invoice',
        ));

        return (new InvoiceResource($updated->load(['classification', 'lines.product', 'lines.costCenterAllocations.costCenter'])))->response();
    }

    /** ينشئ مسودة مستقلة من فاتورة مرئية، بلا أثر ترحيل أو سداد من المصدر. */
    public function duplicate(Request $request, string $id): JsonResponse
    {
        // REM-03b: المصدر يُحلّ بالفرع النشط فقط (لا يوسّعه `?branch=all`) قبل أي مسودة/سطر/رقم.
        $invoice = $this->targetInvoice($id);
        $copy = $this->domain(fn () => $this->invoices->duplicate($invoice, $request->user()?->id));

        return (new InvoiceResource($copy->load('priceList', 'lines.product', 'lines.costCenterAllocations.costCenter')))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * حذف فاتورة مسوّدة (draft فقط). المرحّلة لا تُحذف (سلامة الأثر المحاسبي).
     */
    public function destroy(string $id): JsonResponse
    {
        $invoice = $this->targetInvoice($id);
        $this->domain(fn () => $this->invoices->deleteDraft($invoice));

        return response()->json(['message' => 'تم الحذف.']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        // الحارس قبل أي أثر: لا قيد ولا ICV ولا QR/XML ولا حركة مخزون عند الرفض.
        $invoice = $this->targetInvoice($id);
        $this->assertWarehouseAllowed($invoice->warehouse_id, $invoice->branch_id);

        // REM-04 / SEC-02: ضحية جمود/تسلسل (40P01/40001) ⇒ 503 + Retry-After + error_code ثابت —
        // على هذا المسار وحده. المعاملة أُلغيت كاملةً فإعادة الطلب آمنة؛ أي خطأ قاعدة بيانات آخر يبقى 500.
        try {
            $posted = $this->domain(fn () => $this->invoices->post($invoice, null, $request->user()));
        } catch (PDOException $e) {
            if (ConcurrencyConflict::matches($e)) {
                return ConcurrencyConflict::response();
            }

            throw $e;
        }

        return (new InvoiceResource($posted->load(['priceList', 'lines.product', 'lines.costCenterAllocations.costCenter', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision', 'printTemplateOverrideRevision', 'pdfTemplateOverrideRevision'])))->response();
    }

    /** R3: بيانات إيصال ZATCA — نفس منطق `show()` أعلاه، والسبب نفسه. */
    public function zatca(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);

        return response()->json([
            'qr'            => $invoice->zatca_qr,
            'hash'          => $invoice->zatca_hash,
            'uuid'          => $invoice->zatca_uuid,
            'icv'           => $invoice->zatca_icv,
            'previous_hash' => $invoice->zatca_previous_hash,
            'xml'           => $invoice->zatca_xml,
            'issued_at'     => $invoice->issued_at?->utc()->format('Y-m-d\TH:i:s\Z'),
            'document_type' => $invoice->zatca_document_type,
            'submission_type' => match ($invoice->zatca_document_type) {
                'standard' => 'clearance',
                'simplified' => 'reporting',
                default => null,
            },
        ]);
    }

    /**
     * اختيار القائمة لا يقبل إلا إعداداً نشطاً في المؤسسة. الاستثناء الوحيد هو
     * مسودة تحتفظ بالمرجع ذاته بعد تعطيل القائمة؛ لا نعيد تفسير سعر سطورها ولا
     * نحجب قدرتها على تعديل بيانات غير سعرية.
     */
    private function assertSelectablePriceList(?string $priceListId, ?string $currentPriceListId = null): void
    {
        if ($priceListId === null) {
            return;
        }

        $priceList = PriceList::find($priceListId);
        if (! $priceList) {
            abort(422, 'قائمة الأسعار غير موجودة.');
        }
        if (! $priceList->is_active && $priceList->id !== $currentPriceListId) {
            abort(422, 'قائمة الأسعار المحددة غير نشطة.');
        }
    }

    /** الفاتورة وملحقاتها المقروءة تحترم الفرع النشط، لا مجرد عزل المستأجر. */
    private function visibleInvoice(Request $request, string $id): Invoice
    {
        return $this->scopeToActiveBranch(Invoice::query(), $request)->findOrFail($id);
    }

    /**
     * REM-03 / SEC-01 (+ REM-03b): فاتورة هدف عملية **تغييرية** (تعديل/تصنيف/حذف/ترحيل،
     * ونسخ الفاتورة وإضافة ملاحظة) —
     * الفرع النشط فقط. لا يوسّعها `?branch=all` (على عكس `visibleInvoice()` الخاصة
     * بالقراءة). انظر `ApiController::scopeToCurrentBranchOnly()`.
     */
    private function targetInvoice(string $id): Invoice
    {
        return $this->scopeToCurrentBranchOnly(Invoice::query())->findOrFail($id);
    }

    private function moneyFilterToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);

        return ((int) $whole * 100) + (int) $fraction;
    }
}
