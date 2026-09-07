<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreSupplierRefundRequest;
use App\Http\Resources\SupplierRefundResource;
use App\Models\SupplierRefund;
use App\Services\Accounting\SupplierRefundService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ACC-RET-1 — استرداد المورّد: مستندٌ مالي مستقل عن مرتجع المشتريات.
 * المرتجع يعكس الذمّة تجارياً، وهذا يسجّل عودة المال فعلاً.
 */
class SupplierRefundController extends ApiController
{
    public function __construct(private SupplierRefundService $refunds) {}

    public function index(Request $request): JsonResponse
    {
        $query = SupplierRefund::with('partner')->orderByDesc('refund_date')->orderByDesc('number');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($partnerId = $request->query('partner_id')) {
            $query->where('partner_id', $partnerId);
        }

        $refunds = $this->scopeToActiveBranch($query, $request)->get();

        return response()->json(['data' => SupplierRefundResource::collection($refunds)]);
    }

    public function show(string $id): JsonResponse
    {
        $refund = SupplierRefund::with(['partner', 'allocations.purchaseReturn'])->findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        return response()->json(['data' => new SupplierRefundResource($refund)]);
    }

    /**
     * مرتجعات المشتريات المرحّلة لمورّد ولها رصيد قابل للاسترداد — تغذّي
     * شاشة الإنشاء بالأرقام الفعلية بدل أن تحسبها الواجهة بنفسها.
     */
    public function eligibleReturns(string $partnerId): JsonResponse
    {
        return response()->json(['data' => $this->refunds->eligibleReturns($partnerId)]);
    }

    public function store(StoreSupplierRefundRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['created_by'] = $request->user()?->id;

        $refund = $this->domain(fn () => $this->refunds->create($data, $data['allocations']));

        return response()->json([
            'data' => new SupplierRefundResource($refund->load(['partner', 'allocations.purchaseReturn'])),
        ], 201);
    }

    public function update(StoreSupplierRefundRequest $request, string $id): JsonResponse
    {
        $refund = SupplierRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $data = $request->validated();
        $updated = $this->domain(fn () => $this->refunds->update($refund, $data, $data['allocations']));

        return response()->json([
            'data' => new SupplierRefundResource($updated->load(['partner', 'allocations.purchaseReturn'])),
        ]);
    }

    public function destroy(string $id): JsonResponse
    {
        $refund = SupplierRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $this->domain(fn () => $this->refunds->delete($refund));

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $refund = SupplierRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $posted = $this->domain(fn () => $this->refunds->post($refund, $request->user()));

        return response()->json([
            'data' => new SupplierRefundResource($posted->load(['partner', 'allocations.purchaseReturn'])),
        ]);
    }

    public function reverse(Request $request, string $id): JsonResponse
    {
        $refund = SupplierRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $reversed = $this->domain(fn () => $this->refunds->reverse(
            $refund,
            $request->input('date'),
            $request->input('reason'),
        ));

        return response()->json([
            'data' => new SupplierRefundResource($reversed->load(['partner', 'allocations.purchaseReturn'])),
        ]);
    }
}
