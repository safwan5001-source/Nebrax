<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreProcurementDocumentRequest;
use App\Http\Requests\UpdateProcurementDocumentRequest;
use App\Http\Resources\ProcurementDocumentResource;
use App\Http\Resources\PurchaseResource;
use App\Models\Partner;
use App\Models\ProcurementDocument;
use App\Models\Product;
use App\Services\Accounting\ProcurementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * دورة الشراء — طلب شراء · طلب عروض · عرض مورّد · أمر شراء.
 * مستندات تجارية لا محاسبية: لا يمرّ شيء منها بالمحرك.
 */
class ProcurementController extends ApiController
{
    public function __construct(protected ProcurementService $procurement) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'type'   => ['nullable', 'in:request,rfq,quotation,order'],
            'status' => ['nullable', 'in:draft,submitted,approved,rejected,converted,cancelled'],
        ]);

        $query = ProcurementDocument::with(['lines', 'partner'])->latest();

        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        return ProcurementDocumentResource::collection(
            $this->scopeToActiveBranch($query, $request)->get()
        )->response();
    }

    public function store(StoreProcurementDocumentRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(Partner::class, $data['partner_id'] ?? null, 'المورّد');
        $this->assertTenantOwned(ProcurementDocument::class, $data['source_document_id'] ?? null, 'المستند المصدر');
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $doc = $this->domain(fn () => $this->procurement->create($data, $data['items']));

        return (new ProcurementDocumentResource($doc))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        $doc = ProcurementDocument::with([
            'lines', 'partner', 'invitations', 'sourceDocument', 'revisedFrom',
            'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision',
        ])->findOrFail($id);

        return (new ProcurementDocumentResource($doc))->response();
    }

    public function update(UpdateProcurementDocumentRequest $request, string $id): JsonResponse
    {
        $doc  = ProcurementDocument::findOrFail($id);
        $data = $request->validated();
        $this->assertTenantOwned(Partner::class, $data['partner_id'] ?? null, 'المورّد');

        if (isset($data['items'])) {
            $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');
        }

        $updated = $this->domain(fn () => $this->procurement->update($doc, $data, $data['items'] ?? null));

        return (new ProcurementDocumentResource($updated->load('partner')))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $doc = ProcurementDocument::findOrFail($id);

        if ($doc->isPrintIssued()) {
            abort(422, 'لا يمكن حذف أمر شراء صادر للطباعة. أنشئ نسخة عمل أولاً.');
        }
        if ($doc->isConverted()) {
            abort(422, 'لا يمكن حذف مستند مُحوَّل — هو مصدر ما تلاه.');
        }
        $doc->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** يثبت قوالب الإخراج ويقفل أمر الشراء عند إجراء الإصدار الصريح. */
    public function issue(string $id): JsonResponse
    {
        $doc = ProcurementDocument::findOrFail($id);
        $issued = $this->domain(fn () => $this->procurement->issueForPrint($doc));

        return (new ProcurementDocumentResource($issued->load([
            'lines', 'partner', 'invitations', 'sourceDocument', 'revisedFrom',
            'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision',
        ])))->response();
    }

    /** ينشئ نسخة عمل مسودة من أمر شراء صادر من دون تعديل المصدر التاريخي. */
    public function revise(string $id): JsonResponse
    {
        $doc = ProcurementDocument::findOrFail($id);
        $revision = $this->domain(fn () => $this->procurement->createPrintRevision($doc));

        return (new ProcurementDocumentResource($revision->load([
            'lines', 'partner', 'invitations', 'sourceDocument', 'revisedFrom',
        ])))->response()->setStatusCode(201);
    }

    /** نقل الحالة: اعتماد/رفض/إرسال/إلغاء. */
    public function transition(Request $request, string $id): JsonResponse
    {
        $request->validate(['status' => ['required', 'in:draft,submitted,approved,rejected,cancelled']]);
        $doc = ProcurementDocument::findOrFail($id);

        $updated = $this->domain(fn () => $this->procurement->transition($doc, $request->input('status')));

        return (new ProcurementDocumentResource($updated->load('partner')))->response();
    }

    /**
     * التحويل إلى المرحلة التالية. `target=purchase` يولّد فاتورة مشتريات
     * (draft) من أمر الشراء — بلا ترحيل، فلا أثر محاسبي حتى يرحّلها المستخدم.
     */
    public function convert(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'target'       => ['required', 'in:rfq,quotation,order,purchase'],
            'partner_id'   => ['nullable', 'uuid'],
            'payment_type' => ['nullable', 'in:cash,credit'],
        ]);

        $doc = ProcurementDocument::findOrFail($id);
        $this->assertTenantOwned(Partner::class, $request->input('partner_id'), 'المورّد');

        if ($request->input('target') === 'purchase') {
            $purchase = $this->domain(fn () => $this->procurement->convertToPurchase(
                $doc, $request->input('payment_type', 'credit')
            ));

            return (new PurchaseResource($purchase->load('lines')))->response()->setStatusCode(201);
        }

        $overrides = array_filter(['partner_id' => $request->input('partner_id')], fn ($v) => $v !== null);
        $target = $this->domain(fn () => $this->procurement->convert($doc, $request->input('target'), $overrides));

        return (new ProcurementDocumentResource($target))->response()->setStatusCode(201);
    }
}
