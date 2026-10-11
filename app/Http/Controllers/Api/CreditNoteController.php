<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\EnsureApplicationOperationActive;
use App\Http\Requests\StoreCreditNoteRequest;
use App\Http\Resources\CreditNoteResource;
use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Services\Accounting\CreditNoteService;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CreditNoteController extends ApiController
{
    public function __construct(protected CreditNoteService $creditNotes) {}

    public function index(Request $request): JsonResponse
    {
        $type = $request->query('type');

        $query = CreditNote::with('lines')->latest();
        if (in_array($type, ['sales', 'purchase'], true)) {
            $query->where('type', $type);
        } elseif ($request->attributes->get(EnsureApplicationOperationActive::hiddenPurchaseAttribute('credit-note'))) {
            $query->where('type', '!=', 'purchase');
        }

        return CreditNoteResource::collection(
            $this->scopeToActiveBranch($query, $request)->get()
        )->response();
    }

    public function store(StoreCreditNoteRequest $request): JsonResponse
    {
        $data = $request->validated();
        Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        // الفاتورة المصدر تُحلّ تحت عزل المستأجر (404 لمعرّف مستأجر آخر)، ومن لا يملك
        // فرعها لا يرجع إليها: «موجود لكن ممنوع» لا يُميَّز عن «غير موجود».
        if (! empty($data['original_invoice_id'])) {
            $invoice = Invoice::findOrFail($data['original_invoice_id']);
            $this->assertRecordAccessible($invoice->branch_id, []);
        }

        $note = $this->domain(fn () => $this->creditNotes->create($data, $data['items']));

        return (new CreditNoteResource($note->load('lines')))->response()->setStatusCode(201);
    }

    /**
     * فواتير الطرف الصالحة مصدراً للإشعار (REM-02) — نفس قائمة المرتجعات بتصفية الفروع المتاحة للمستخدم،
     * لكن بصلاحية إنشاء الإشعار وتشغيله لا بصلاحية/تشغيل المرتجعات.
     */
    public function sources(Request $request): JsonResponse
    {
        $request->query->set('purpose', 'credit_note');

        return app(ReturnSourcesController::class)($request, 'sales');
    }

    /** سطور فاتورة مصدر بكمياتها المتبقية للإشعار؛ فاتورة فرعٍ ممنوع ⇒ 404 (كما `store`). */
    public function returnable(Request $request, string $invoice): JsonResponse
    {
        $request->query->set('purpose', 'credit_note');

        return app(ReturnableController::class)($request, 'sales', $invoice);
    }

    public function show(string $id): JsonResponse
    {
        $note = CreditNote::with(['lines', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])->findOrFail($id);
        $this->assertRecordAccessible($note->branch_id, []);

        return (new CreditNoteResource($note))->response();
    }

    public function post(string $id): JsonResponse
    {
        $note = CreditNote::findOrFail($id);
        $this->assertRecordAccessible($note->branch_id, []);
        // فرع الفاتورة المصدر يُعاد فحصه عند الترحيل لا عند الإنشاء فقط: المسوّدة قد تكون أُنشئت بصلاحية أوسع
        // أو تغيّر نطاق فروع المستخدم بعدها (نفس قاعدة `store`، 404 غير مُسرِّب).
        if ($note->original_invoice_id !== null) {
            $this->assertRecordAccessible(
                BranchScope::reference(Invoice::class)->whereKey($note->original_invoice_id)->value('branch_id'),
                []
            );
        }
        $posted = $this->domain(fn () => $this->creditNotes->post($note));

        return (new CreditNoteResource($posted->load(['lines', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }
}
