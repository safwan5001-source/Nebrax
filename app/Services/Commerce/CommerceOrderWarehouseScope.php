<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * COPS-H2-2 (D-H2-11) — رؤية المستخدم المقيَّد بمخازن لطلبات المتجر عبر **المخزن الفعّال للطلب** (مصدر واحد للقائمة والتفاصيل والإجراءات والانتباه):
 *
 *   المخزن الفعّال = مخزن صف التنفيذ إن وُجد ← وإلا مخزن حجز الطلب (الأقدم) ← وإلا مخزن **سياسة القناة الحالي** ← وإلا لا مخزن (غير مرئي: فشل مغلق).
 *
 * الترتيب نفسه الذي تثبّت به `CommerceOrderFulfillmentService` لقطة مخزن التنفيذ عند البدء، فلا يتغيّر مخزن طلب بدأ تنفيذه. السياسة «الحالية» معلنة: طلب لم يبدأ
 * وبلا حجز يتبع مخزن سياسة قناته الآن (R-H2-03). غير المقيَّد (`null`) لا تصفية. SQL واحد بلا استعلام لكل صف؛ كل الاستعلامات الفرعية مقيَّدة بمستأجر الطلب صراحةً
 * (SQL خام لا يمرّ بنطاق المستأجر). طلب خارج النطاق ⇒ غير موجود (404 موحَّد في المتحكّمات). التغذية (`feed`) خارج هذا المصدر: تبقى 403 للمقيَّد حتى H3.
 */
final class CommerceOrderWarehouseScope
{
    /**
     * @param  Builder<CommerceOrder>  $query
     * @param  ?list<string>  $allowedWarehouseIds  null = غير مقيَّد
     * @return Builder<CommerceOrder>
     */
    public static function apply(Builder $query, ?array $allowedWarehouseIds): Builder
    {
        if ($allowedWarehouseIds === null) {
            return $query;
        }
        if ($allowedWarehouseIds === []) {
            return $query->whereRaw('1 = 0');
        }
        $in = implode(',', array_fill(0, count($allowedWarehouseIds), '?'));

        return $query->whereRaw(
            "COALESCE(
                (SELECT f.warehouse_id FROM commerce_order_fulfillments f WHERE f.commerce_order_id = commerce_orders.id AND f.tenant_id = commerce_orders.tenant_id),
                (SELECT r.warehouse_id FROM inventory_reservations r WHERE r.source_type = ? AND r.source_id = commerce_orders.id AND r.tenant_id = commerce_orders.tenant_id ORDER BY r.created_at, r.id LIMIT 1),
                (SELECT p.warehouse_id FROM fulfillment_policies p WHERE p.sales_channel_id = commerce_orders.sales_channel_id AND p.tenant_id = commerce_orders.tenant_id LIMIT 1)
            ) IN ({$in})",
            [CommerceOrder::class, ...array_values($allowedWarehouseIds)],
        );
    }

    /**
     * إعادة تحقق **داخل معاملة الكتابة وبعد أقفال النية/الطلب/التنفيذ** (Codex على H2-2): البحث المقيَّد في المتحكّم يسبق المعاملة، فتغيّر سياسة القناة أو حجز الطلب
     * بينهما قد يُخرج الطلب من نطاق الفاعل. غير المقيَّد لا يُفحص. الطلب خارج النطاق الآن ⇒ `NotFoundHttpException` (404 موحَّد، يتراجع معه كل شيء) — كأنه لم يكن مرئياً.
     * القراءة بلا قفل إضافي (لا قفل على سياسة القناة ⇒ لا حافة قفل جديدة)؛ النافذة المتبقية تخص «من يحق له الفعل» لحظة الالتزام لا سلامة البيانات.
     */
    public static function assertVisible(CommerceOrder $order, ?User $actor): void
    {
        $allowed = $actor?->allowedWarehouseIds();
        if ($allowed === null) {
            return;
        }
        $visible = self::apply(CommerceOrder::query()->whereKey($order->id), $allowed)->exists();
        if (! $visible) {
            throw new NotFoundHttpException('الطلب غير موجود.');
        }
    }

    /** مخزن سيُثبَّت في صف تنفيذ جديد يجب أن يكون ضمن نطاق الفاعل المقيَّد (يُستدعى بالمخزن المحلول نفسه الذي سيُكتب، فلا فجوة بين الفحص والكتابة). */
    public static function assertWarehouseAllowed(?string $warehouseId, ?User $actor): void
    {
        $allowed = $actor?->allowedWarehouseIds();
        if ($allowed === null) {
            return;
        }
        if ($warehouseId === null || ! in_array($warehouseId, $allowed, true)) {
            throw new NotFoundHttpException('الطلب غير موجود.');
        }
    }
}
