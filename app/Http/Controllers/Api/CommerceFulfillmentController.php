<?php

namespace App\Http\Controllers\Api;

use App\Models\FulfillmentPolicy;
use App\Models\Storefront;
use App\Models\Warehouse;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * FLOWERS-H2-5 / ADR-27 — مخزن تنفيذ قناة المتجر (شرط «يصل اليوم»، ADR-20): واجهةُ إدارةٍ رفيعة فوق
 * `FulfillmentPolicyService` القائمة — لا نموذج ولا سلطة موازية. `{id}` محدِّد متجر فقط؛ القناة تُشتقّ من المتجر
 * الموثوق (404 غير كاشف)، والمستأجر من `TenantContext`. القراءة والكتابة `commerce.manage`.
 *
 * القائمة المعروضة للاختيار هي مخازن المستأجر نفسه (ضمن مخازن المستخدم المسموحة إن قُيِّد)، في الاستجابة ذاتها،
 * فلا يحتاج التاجر صلاحية مخزون منفصلة لاختيار مخزن التنفيذ. لا مسح للتعيين هنا: التغيير باستبدال مخزنٍ نشط.
 */
final class CommerceFulfillmentController extends ApiController
{
    public function show(Request $request, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->ownedStorefront($id);

        return response()->json(['data' => $this->document($request, $storefront)]);
    }

    public function update(Request $request, FulfillmentPolicyService $fulfillment, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate(['warehouse_id' => ['required', 'uuid']]);
        $storefront = $this->ownedStorefront($id);

        $allowed = $request->user()?->allowedWarehouseIds();
        $warehouse = Warehouse::query()
            ->when($allowed, fn ($q, $ids) => $q->whereIn('id', $ids))
            ->find($data['warehouse_id']);
        // مخزن غير موجود/غير مسموح/لمستأجرٍ آخر ⇒ رسالة واحدة لا تكشف أيّها.
        abort_if($warehouse === null, 422, 'المخزن غير موجود.');
        abort_if(! $warehouse->is_active, 422, 'لا يمكن اختيار مخزن غير نشط لتنفيذ الطلبات.');

        try {
            $fulfillment->setFixedWarehouse($storefront->sales_channel_id, $warehouse->id);
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => $this->document($request, $storefront)]);
    }

    /** @return array<string, mixed> */
    private function document(Request $request, Storefront $storefront): array
    {
        $policy = FulfillmentPolicy::query()->where('sales_channel_id', $storefront->sales_channel_id)->first();
        $allowed = $request->user()?->allowedWarehouseIds();
        $current = $policy !== null ? Warehouse::query()->find($policy->warehouse_id) : null;

        return [
            'fulfillment' => ['warehouse' => $current !== null ? $this->warehouse($current) : null],
            'warehouses' => Warehouse::query()
                ->when($allowed, fn ($q, $ids) => $q->whereIn('id', $ids))
                ->orderBy('code')
                ->get()
                ->map(fn (Warehouse $w) => $this->warehouse($w))
                ->values()
                ->all(),
        ];
    }

    /** @return array{id: string, code: ?string, name: string, city: ?string, is_active: bool} */
    private function warehouse(Warehouse $w): array
    {
        return ['id' => $w->id, 'code' => $w->code, 'name' => $w->name, 'city' => $w->city, 'is_active' => (bool) $w->is_active];
    }

    private function ownedStorefront(string $id): Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($id);
        abort_if($storefront === null || $storefront->tenant_id !== $tenantId, 404, 'المتجر غير موجود.');

        return $storefront;
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
