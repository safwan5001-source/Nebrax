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
use App\Models\StockMovement;
use App\Support\Money;
use App\Services\Accounting\InvoiceRelationsService;
use App\Services\Accounting\InvoiceService;
use App\Services\ClassificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class InvoiceController extends ApiController
{
    public function __construct(
        protected InvoiceService $invoices,
        protected InvoiceRelationsService $relations,
        protected ClassificationService $classifications,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return InvoiceResource::collection($this->scopeToActiveBranch(Invoice::with('lines.product', 'lines.costCenterAllocations.costCenter')->latest(), $request)->get())->response();
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
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $invoice = $this->domain(fn () => $this->invoices->create($data, $data['items']));

        return (new InvoiceResource($invoice->load('lines.product', 'lines.costCenterAllocations.costCenter')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new InvoiceResource(Invoice::with([
            'lines.product', 'lines.costCenterAllocations.costCenter', 'costCenter', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision',
        ])->findOrFail($id)))->response();
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
        $invoice = $this->visibleInvoice($request, $id);
        $data = $request->validated();
        $note = $invoice->notesLog()->create([
            'recorded_at' => $data['recorded_at'] ?? now(),
            'body'        => $data['body'] ?? null,
            'created_by'  => $request->user()?->id,
        ]);

        foreach ($request->file('attachments', []) as $file) {
            $path = $file->store("invoices/{$invoice->id}/notes/{$note->id}", 'local');
            $note->attachments()->create([
                'disk'          => 'local',
                'path'          => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime_type'     => $file->getMimeType(),
                'size'          => $file->getSize(),
                'uploaded_by'   => $request->user()?->id,
            ]);
        }

        return (new InvoiceNoteResource($note->load('attachments')))->response()->setStatusCode(201);
    }

    /** تنزيل ملف خاص بعد إثبات أنه ينتمي لملاحظة فاتورة مرئية في الفرع النشط. */
    public function downloadNoteAttachment(Request $request, string $id, string $noteId, string $attachmentId): StreamedResponse
    {
        $invoice = $this->visibleInvoice($request, $id);
        $note = $invoice->notesLog()->whereKey($noteId)->firstOrFail();
        $attachment = $note->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = Storage::disk($attachment->disk);

        if (! $disk->exists($attachment->path)) {
            abort(404, 'ملف المرفق غير موجود.');
        }

        return $disk->download($attachment->path, $attachment->original_name, [
            'Content-Type' => $attachment->mime_type ?? 'application/octet-stream',
        ]);
    }

    /**
     * تعديل فاتورة مسوّدة (draft فقط) — نفس تحقّق المراجع في store.
     * المرحّلة immutable؛ الخدمة ترفضها (422).
     */
    public function update(StoreInvoiceRequest $request, string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id); // عزل تلقائي بالمستأجر
        $data = $request->validated();
        $data['minimum_price_override_actor_id'] = $request->user()?->id;

        Partner::findOrFail($data['partner_id']);
        $this->assertWarehouseAllowed($data['warehouse_id'] ?? null, $invoice->branch_id, false);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $updated = $this->domain(fn () => $this->invoices->update($invoice, $data, $data['items']));

        return (new InvoiceResource($updated->load('lines.product', 'lines.costCenterAllocations.costCenter')))->response();
    }

    /**
     * تعديل تحليلي محدود؛ لا يفتح تعديل المبالغ أو البنود أو القيد بعد الترحيل.
     */
    public function updateClassification(UpdateDocumentClassificationRequest $request, string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
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
        $invoice = $this->visibleInvoice($request, $id);
        $copy = $this->domain(fn () => $this->invoices->duplicate($invoice, $request->user()?->id));

        return (new InvoiceResource($copy->load('lines.product', 'lines.costCenterAllocations.costCenter')))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * حذف فاتورة مسوّدة (draft فقط). المرحّلة لا تُحذف (سلامة الأثر المحاسبي).
     */
    public function destroy(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $this->domain(fn () => $this->invoices->deleteDraft($invoice));

        return response()->json(['message' => 'تم الحذف.']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $this->assertWarehouseAllowed($invoice->warehouse_id, $invoice->branch_id);
        $posted = $this->domain(fn () => $this->invoices->post($invoice));

        return (new InvoiceResource($posted->load(['lines.product', 'lines.costCenterAllocations.costCenter', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }

    public function zatca(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);

        return response()->json([
            'qr'            => $invoice->zatca_qr,
            'hash'          => $invoice->zatca_hash,
            'uuid'          => $invoice->zatca_uuid,
            'icv'           => $invoice->zatca_icv,
            'previous_hash' => $invoice->zatca_previous_hash,
            'xml'           => $invoice->zatca_xml,
        ]);
    }

    /** الفاتورة وملحقاتها المقروءة تحترم الفرع النشط، لا مجرد عزل المستأجر. */
    private function visibleInvoice(Request $request, string $id): Invoice
    {
        return $this->scopeToActiveBranch(Invoice::query(), $request)->findOrFail($id);
    }
}
