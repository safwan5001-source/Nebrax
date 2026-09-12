<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreCustomerRefundRequest;
use App\Http\Resources\CustomerRefundResource;
use App\Models\CustomerRefund;
use App\Services\Accounting\CustomerRefundService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PAY-V2-6B — استرداد العميل: مستندٌ مالي مستقل عن مرتجع المبيعات/الإشعار الدائن.
 * التصحيح التجاري يعكس الذمّة، وهذا يسجّل خروج المال فعلاً.
 */
class CustomerRefundController extends ApiController
{
    public function __construct(private CustomerRefundService $refunds) {}

    public function index(Request $request): JsonResponse
    {
        $query = CustomerRefund::with('partner')->orderByDesc('refund_date')->orderByDesc('number');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($partnerId = $request->query('partner_id')) {
            $query->where('partner_id', $partnerId);
        }

        $refunds = $this->scopeToActiveBranch($query, $request)->get();

        return response()->json(['data' => CustomerRefundResource::collection($refunds)]);
    }

    public function show(string $id): JsonResponse
    {
        $refund = CustomerRefund::with(['partner', 'allocations.source'])->findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        return response()->json(['data' => new CustomerRefundResource($refund)]);
    }

    /**
     * التصحيحات التجارية المرحّلة لعميل ولها رصيد قابل للاسترداد — تغذّي
     * شاشة الإنشاء بالأرقام الفعلية بدل أن تحسبها الواجهة بنفسها.
     */
    public function eligibleSources(string $partnerId): JsonResponse
    {
        return response()->json(['data' => $this->refunds->eligibleSources($partnerId)]);
    }

    public function store(StoreCustomerRefundRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['created_by'] = $request->user()?->id;
        unset($data['tenant_id']);

        $refund = $this->domain(fn () => $this->refunds->create($data, $data['allocations']));

        return response()->json([
            'data' => new CustomerRefundResource($refund->load(['partner', 'allocations.source'])),
        ], 201);
    }

    public function update(StoreCustomerRefundRequest $request, string $id): JsonResponse
    {
        $refund = CustomerRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $data = $request->validated();
        unset($data['tenant_id']);
        $updated = $this->domain(fn () => $this->refunds->update($refund, $data, $data['allocations']));

        return response()->json([
            'data' => new CustomerRefundResource($updated->load(['partner', 'allocations.source'])),
        ]);
    }

    public function destroy(string $id): JsonResponse
    {
        $refund = CustomerRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $this->domain(fn () => $this->refunds->delete($refund));

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $refund = CustomerRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $posted = $this->domain(fn () => $this->refunds->post($refund, $request->user()));

        return response()->json([
            'data' => new CustomerRefundResource($posted->load(['partner', 'allocations.source'])),
        ]);
    }

    public function reverse(Request $request, string $id): JsonResponse
    {
        $refund = CustomerRefund::findOrFail($id);
        $this->assertRecordAccessible($refund->branch_id, []);

        $reversed = $this->domain(fn () => $this->refunds->reverse(
            $refund,
            $request->input('date'),
            $request->input('reason'),
        ));

        return response()->json([
            'data' => new CustomerRefundResource($reversed->load(['partner', 'allocations.source'])),
        ]);
    }
}
