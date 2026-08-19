<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreInvoiceNoteRequest;
use App\Http\Requests\StoreInvoiceRequest;
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
use App\Services\Accounting\InvoiceRelationsService;
use App\Services\Accounting\InvoiceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class InvoiceController extends ApiController
{
    public function __construct(
        protected InvoiceService $invoices,
        protected InvoiceRelationsService $relations,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return InvoiceResource::collection($this->scopeToActiveBranch(Invoice::with('lines.product')->latest(), $request)->get())->response();
    }

    public function store(StoreInvoiceRequest $request): JsonResponse
    {
        $data = $request->validated();

        // عزل: كل المراجع يجب أن تخص المستأجر الحالي (تصدّ حقن معرّفات مستأجرين آخرين)
        Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $invoice = $this->domain(fn () => $this->invoices->create($data, $data['items']));

        return (new InvoiceResource($invoice->load('lines.product')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new InvoiceResource(Invoice::with([
            'lines.product', 'costCenter', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision',
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

        Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertTenantOwned(Employee::class, $data['salesperson_id'] ?? null, 'مسؤول المبيعات');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $updated = $this->domain(fn () => $this->invoices->update($invoice, $data, $data['items']));

        return (new InvoiceResource($updated->load('lines')))->response();
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

    public function post(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $posted = $this->domain(fn () => $this->invoices->post($invoice));

        return (new InvoiceResource($posted->load(['lines.product', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
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
