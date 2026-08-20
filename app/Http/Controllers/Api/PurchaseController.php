<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePurchaseRequest;
use App\Http\Requests\UpdateDocumentClassificationRequest;
use App\Http\Resources\PurchaseResource;
use App\Models\CostCenter;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\StockMovement;
use App\Services\Accounting\PurchaseRelationsService;
use App\Services\Accounting\PurchaseService;
use App\Services\ClassificationService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PurchaseController extends ApiController
{
    public function __construct(
        protected PurchaseService $purchases,
        protected PurchaseRelationsService $relations,
        protected ClassificationService $classifications,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return PurchaseResource::collection($this->scopeToActiveBranch(Purchase::with('lines')->latest(), $request)->get())->response();
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
        return (new PurchaseResource($this->visiblePurchase($request, $id)->load(['lines', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
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
        $this->domain(fn () => $this->purchases->deleteDraft($purchase));

        return response()->json(['message' => 'تم الحذف.']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $purchase = Purchase::findOrFail($id);
        $this->assertWarehouseAllowed($purchase->warehouse_id, $purchase->branch_id);
        $posted = $this->domain(fn () => $this->purchases->post($purchase));

        return (new PurchaseResource($posted->load(['lines', 'printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])))->response();
    }

    private function visiblePurchase(Request $request, string $id): Purchase
    {
        return $this->scopeToActiveBranch(Purchase::query(), $request)->findOrFail($id);
    }
}
