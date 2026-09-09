<?php

namespace App\Services\Commerce;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Commerce Listing — عرض منتج على قناة بيع (PR-COM-3، Master Plan §PHASE 3)
 * ═══════════════════════════════════════════════════════════════
 *
 * يفصل حقيقة المنتج الأساسية (`Product`: SKU/باركود/وحدة/تكلفة/محاسبة) عن
 * عرضه/نشره التجاري حسب القناة. لا سعر، لا ضريبة، لا مخزون/ATS، لا مخزن
 * تنفيذ، لا أثر محاسبي — أياً من هذه يُقرأ أو يُكتَب هنا؛ تلك مسؤوليات
 * وحداتها الأصلية (PriceList لاحقاً في COM-4A، ProductWarehouseStock/
 * InventoryReservationService، SalesChannel→FulfillmentPolicy، Invoice/
 * LedgerService). راجع `App\Support\CommerceBoundary`.
 *
 * **العزل بلا ثقة بالمعرّفات الواردة**: قيد FK وحده لا يثبت أن المنتج
 * والقناة ينتميان لمستأجر السياق الحالي. `configure()` يتحقق صراحةً عبر
 * `Product::whereKey()`/`SalesChannel::whereKey()` (كلاهما `BaseModel`
 * فيُصفَّيان تلقائياً بـ`TenantScope` الحالي) **قبل** أي كتابة — نفس نمط
 * `InventoryReservationService::acquire()`/`FulfillmentPolicyService::setFixedWarehouse()`
 * حرفياً. `Product` وحده `BranchScoped`/`BranchShareable` (لا `SalesChannel`)،
 * فيتجاوز فحص وجوده `BranchScope` وحده — بنفس سبب
 * `AvailableToSellService::forWarehouse()`/`InventoryReservationService::acquire()`:
 * العرض يُطلب لمنتجٍ مسمّى صراحةً، لا للفرع النشط العابر لسياق الطلب.
 *
 * **دلالة العرض الظاهر (fallback)**: `title`/`description` تجاوزان
 * اختياريان بلا نسخ من المنتج عند الإنشاء — `CommerceListing::displayTitle()`/
 * `displayDescription()` يحسمان `null ⇐ عرض المنتج` عند القراءة فقط، فلا
 * ازدواج حقيقة مخزَّنة.
 */
final class CommerceListingService
{
    /**
     * ينشئ (أو يحدّث) عرض منتج على قناة. صفٌّ واحد لكل زوج منتج×قناة —
     * `unique(['product_id','sales_channel_id'])` يمنع الازدواج بنيوياً.
     *
     * @param  array{title?: ?string, description?: ?string}  $presentation
     * @throws RuntimeException المنتج أو القناة غير موجودين لمستأجر السياق الحالي.
     */
    public function configure(string $productId, string $salesChannelId, array $presentation = []): CommerceListing
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        if (! Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($productId)->exists()) {
            throw new RuntimeException('المنتج غير موجود.');
        }
        if (! SalesChannel::query()->whereKey($salesChannelId)->exists()) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }

        $keys = ['product_id' => $productId, 'sales_channel_id' => $salesChannelId];
        $existing = CommerceListing::query()->where($keys)->first();

        // كل مكالمة تُحدِّث فقط الحقول المُمرَّرة صراحةً — لا تكتسح الأخرى
        // إلى null، فإعداد الوصف لاحقاً لا يمحو عنواناً سبق ضبطه.
        return CommerceListing::query()->updateOrCreate($keys, [
            'tenant_id' => $tenantId,
            'title' => array_key_exists('title', $presentation) ? $presentation['title'] : $existing?->title,
            'description' => array_key_exists('description', $presentation) ? $presentation['description'] : $existing?->description,
        ]);
    }
}
