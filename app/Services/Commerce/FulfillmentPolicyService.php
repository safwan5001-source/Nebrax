<?php

namespace App\Services\Commerce;

use App\Models\FulfillmentPolicy;
use App\Models\SalesChannel;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Fulfillment Policy — قناة → مخزن تنفيذ واحد ثابت (PR-COM-2B، ADR-03)
 * ═══════════════════════════════════════════════════════════════
 *
 * V1 يدعم `FIXED_LOCATION` حصراً: قناةٌ واحدة → صفر أو مخزن تنفيذ واحد
 * صريح، لا قائمة، لا أولوية، لا توزيع تلقائي (ADR-03 §4/§8). لا شيء هنا
 * يقرأ أو يكتب مخزوناً — لا `ProductWarehouseStock`، لا
 * `InventoryReservation`، لا `StockMovement`، لا قيدٌ محاسبي. القرار
 * يُرجَع مخزناً صريحاً؛ استهلاكه في ATS/الحجز مسؤولية المستدعي المستقبلي.
 *
 * **العزل بلا ثقة بالمعرّفات الواردة**: قيد FK وحده لا يثبت أن القناة
 * والمخزن ينتميان لمستأجر السياق الحالي — يثبت فقط وجودهما في جدوليهما
 * *كيفما كانا*. لذلك يتحقق `setFixedWarehouse()`/`resolveWarehouseFor()`
 * صراحةً عبر `SalesChannel::whereKey()`/`Warehouse::whereKey()` (كلاهما
 * `BaseModel` فيُصفَّيان تلقائياً بـ`TenantScope` الحالي) **قبل** أي قراءة
 * أو كتابة — لا اعتماد على FK وحده، مطابقٌ لنمط
 * `InventoryReservationService::acquire()` (PR-COM-1B) حرفياً. كلا
 * `SalesChannel` و`Warehouse` مصنَّفان `CompanyWide` بلا `BranchScoped`،
 * فلا حاجة لتجاوز `BranchScope` هنا كما احتاجت ATS/الحجز مع `Product`.
 */
final class FulfillmentPolicyService
{
    /**
     * يضبط (أو يستبدل) المخزن الثابت لقناة. صفٌّ واحد لكل قناة —
     * `unique('sales_channel_id')` يمنع ازدواج السياسات بنيوياً.
     *
     * @throws RuntimeException القناة أو المخزن غير موجودين لمستأجر السياق الحالي.
     */
    public function setFixedWarehouse(string $salesChannelId, string $warehouseId): FulfillmentPolicy
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        if (! SalesChannel::query()->whereKey($salesChannelId)->exists()) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }
        if (! Warehouse::query()->whereKey($warehouseId)->exists()) {
            throw new RuntimeException('المخزن غير موجود.');
        }

        return FulfillmentPolicy::query()->updateOrCreate(
            ['sales_channel_id' => $salesChannelId],
            ['tenant_id' => $tenantId, 'warehouse_id' => $warehouseId],
        );
    }

    /**
     * يحسم مخزن التنفيذ لقناة — دون قراءة أو تعديل أي مخزون. فشلٌ صريح
     * دائماً بدل أي fallback: لا مخزنٍ افتراضي، لا أول مخزن، لا مخزن فرع.
     *
     * @throws RuntimeException القناة غير موجودة لمستأجر السياق الحالي.
     * @throws FulfillmentPolicyNotConfiguredException لا سياقة صالحة قابلة للحسم الآن.
     */
    public function resolveWarehouseFor(string $salesChannelId): Warehouse
    {
        $channel = SalesChannel::query()->find($salesChannelId);
        if ($channel === null) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }

        if (! $channel->is_active) {
            throw new FulfillmentPolicyNotConfiguredException('القناة معطّلة — لا مصدر تنفيذ صالحاً.');
        }

        $policy = FulfillmentPolicy::query()->where('sales_channel_id', $salesChannelId)->first();
        if ($policy === null) {
            throw new FulfillmentPolicyNotConfiguredException('لا توجد سياسة تنفيذ مضبوطة لهذه القناة.');
        }

        // مرجعٌ مخزَّن على القناة نفسها بلا مرور بـ TenantScope مرّة أخرى —
        // السياسة نفسها مُصفّاة بالفعل بمستأجر السياق الحالي.
        $warehouse = Warehouse::query()->find($policy->warehouse_id);
        if ($warehouse === null || ! $warehouse->is_active) {
            throw new FulfillmentPolicyNotConfiguredException('مخزن السياسة غير موجود أو غير نشط.');
        }

        return $warehouse;
    }
}
