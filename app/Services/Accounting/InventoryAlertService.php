<?php

namespace App\Services\Accounting;

use App\Models\InventoryStockAlert;
use App\Models\Product;
use App\Models\User;
use App\Services\NotificationService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تنبيهات المخزون (PR-NOTIF-3) — منخفض/نافد، قراءة-فقط على المخزون
 * ═══════════════════════════════════════════════════════════════
 *  لا يكتب هذا المحرك إلى `products` ولا `stock_movements` ولا أي جدول
 *  محاسبي؛ الأثر الوحيد القابل للكتابة سجلّ `InventoryStockAlert` (حالة داخلية)
 *  وإشعارات عبر `NotificationService::deliver()` (§5.1). يعيد استخدام
 *  `products.reorder_level` حرفياً — بلا حقل عتبة جديد ولا تفسير فرعي له.
 *
 *  **الشروط (ADR-07 في الخطة الرئيسية):**
 *   - منخفض: track_inventory وquantity_on_hand>0 وreorder_level>0 وquantity_on_hand<=reorder_level.
 *   - نافد: track_inventory وquantity_on_hand<=0.
 *  مطابقة حرفياً لحالتَي `low`/`out` في `App\Support\ProductListFilters::apply()` —
 *  أي تغيير هناك يجب أن يُطابَق هنا يدوياً (لا مصدر مشترك: هناك فلتر SQL،
 *  وهنا فحصٌ على نموذج مُحمَّل).
 *
 *  **نقاط التشغيل:** `InventoryService::applyReceipt/applyIssue/recordSaleCogs`
 *  تستدعي `queueEvaluation()` بعد كل تعديل فعلي للكمية — هذه النقاط الثلاث هي
 *  البوابات الوحيدة التي تغيّر `quantity_on_hand` (تحويلات المخازن والجرد
 *  تمرّ بدورها عبر applyReceipt/applyIssue). `queueEvaluation()` يؤجّل التقييم
 *  والتسليم إلى ما بعد الترحيل الفعلي (`DB::afterCommit`) — معاملة قد تتراجع
 *  لا يجب أن تُنشئ إشعاراً. `scanTenant()` مسحٌ دوري احتياطي (منتجات منخفضة/نافدة
 *  أصلاً قبل هذه الميزة، أو أي تعديل مباشر نادر) يستدعي نفس `evaluateProduct()`
 *  فتبقى دورة الحياة بمصدر واحد.
 *
 *  **دورة الحياة والتفرّد:** صفٌّ واحد لكل منتج في `inventory_stock_alerts`.
 *  `cycle` يزداد فقط عند التنشيط من `resolved`/الغياب (طبيعي→منخفض/نافد).
 *  مفتاح تفرّد الإشعار `inventory.{type}:{alert_id}:{cycle}` — نفس النوع ضمن
 *  نفس الدورة لا يكرّر (يتولاه `NotificationService::deliver()` نفسه)، وتبدّل
 *  النوع ضمن الدورة (منخفض←→نافد) يُنتج مفتاحاً جديداً فينبّه من جديد. العودة
 *  إلى الطبيعي تُحلّ الحالة بصمتٍ (بلا إشعار) والانخفاض التالي يفتح دورة جديدة.
 */
class InventoryAlertService
{
    private const BLOCKED_SETTING_KEYS = [
        InventoryStockAlert::TYPE_LOW_STOCK => 'low_stock_notifications_enabled',
        InventoryStockAlert::TYPE_OUT_OF_STOCK => 'out_of_stock_notifications_enabled',
    ];

    /** يؤجَّل التقييم إلى ما بعد نجاح المعاملة المحيطة — لا إشعار لمعاملة قد تتراجع. */
    public function queueEvaluation(string $productId): void
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return;
        }

        DB::afterCommit(function () use ($tenantId, $productId) {
            $this->evaluateProduct($tenantId, $productId);
        });
    }

    /**
     * مسح احتياطي دوري لكل منتجات مستأجر متتبَّعة — يلتقط ما كان منخفضاً/نافداً
     * قبل تفعيل الإعداد أو قبل بناء هذه الميزة، ولا يحتاج تعديل كمية لاحقاً
     * ليُكتشف. آمن التكرار: يستدعي نفس `evaluateProduct()`.
     *
     * @return array{enabled: bool, scanned: int}
     */
    public function scanTenant(string $tenantId): array
    {
        $lowEnabled = (bool) Settings::get('inventory', 'low_stock_notifications_enabled');
        $outEnabled = (bool) Settings::get('inventory', 'out_of_stock_notifications_enabled');
        if (! $lowEnabled && ! $outEnabled) {
            return ['enabled' => false, 'scanned' => 0];
        }

        $productIds = Product::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('track_inventory', true)
            ->pluck('id');

        foreach ($productIds as $productId) {
            $this->evaluateProduct($tenantId, $productId);
        }

        return ['enabled' => true, 'scanned' => $productIds->count()];
    }

    /** تقييم منتج واحد بمعرّفه — الأولية الوحيدة التي تكتب حالة/تسلّم إشعاراً. */
    public function evaluateProduct(string $tenantId, string $productId): void
    {
        DB::transaction(function () use ($tenantId, $productId) {
            $product = Product::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($productId)
                ->lockForUpdate()
                ->first();

            if (! $product) {
                return;
            }

            $alert = InventoryStockAlert::query()
                ->where('tenant_id', $tenantId)
                ->where('product_id', $product->id)
                ->lockForUpdate()
                ->first();

            $type = $this->conditionType($product);

            if ($type === null || ! $this->isEnabled($tenantId, $type)) {
                if ($alert && $alert->status === InventoryStockAlert::STATUS_ACTIVE) {
                    $alert->update(['status' => InventoryStockAlert::STATUS_RESOLVED, 'resolved_at' => now()]);
                }

                return;
            }

            $wasActive = $alert !== null && $alert->status === InventoryStockAlert::STATUS_ACTIVE;
            $cycle = $wasActive ? $alert->cycle : ($alert->cycle ?? 0) + 1;
            $firstDetectedAt = $wasActive ? $alert->first_detected_at : now();

            $alert = InventoryStockAlert::updateOrCreate(
                ['tenant_id' => $tenantId, 'product_id' => $product->id],
                [
                    'branch_id' => $product->branch_id,
                    'status' => InventoryStockAlert::STATUS_ACTIVE,
                    'type' => $type,
                    'cycle' => $cycle,
                    'quantity_on_hand' => $product->quantity_on_hand,
                    'reorder_level' => $product->reorder_level,
                    'first_detected_at' => $firstDetectedAt,
                    'last_detected_at' => now(),
                    'resolved_at' => null,
                ]
            );

            $this->notifyRecipients($tenantId, $product, $alert, $type);
        });
    }

    /** @return string|null إحدى `InventoryStockAlert::TYPE_*`، أو null إن كان المنتج طبيعياً/غير متتبَّع. */
    private function conditionType(Product $product): ?string
    {
        if (! $product->track_inventory) {
            return null;
        }
        if ($product->quantity_on_hand <= 0) {
            return InventoryStockAlert::TYPE_OUT_OF_STOCK;
        }
        if ($product->reorder_level > 0 && $product->quantity_on_hand <= $product->reorder_level) {
            return InventoryStockAlert::TYPE_LOW_STOCK;
        }

        return null;
    }

    private function isEnabled(string $tenantId, string $type): bool
    {
        return (bool) Settings::get('inventory', self::BLOCKED_SETTING_KEYS[$type]);
    }

    private function notifyRecipients(string $tenantId, Product $product, InventoryStockAlert $alert, string $type): void
    {
        $isOut = $type === InventoryStockAlert::TYPE_OUT_OF_STOCK;
        $severity = $isOut ? 'critical' : 'warning';
        $title = $isOut
            ? "نفاد المخزون: {$product->name}"
            : "مخزون منخفض: {$product->name}";
        $message = $isOut
            ? 'وصلت الكمية المتاحة من هذا الصنف إلى صفر أو أقل.'
            : "الكمية المتاحة ({$product->quantity_on_hand}) عند حد إعادة الطلب ({$product->reorder_level}) أو أقل منه.";
        $dedupeKey = "inventory.{$type}:{$alert->id}:{$alert->cycle}";

        $notifications = app(NotificationService::class);

        foreach ($this->resolveRecipients($tenantId, $product) as $recipient) {
            $notifications->deliver([
                'tenant_id' => $tenantId,
                'recipient_id' => $recipient->id,
                'category' => 'alert',
                'type' => "inventory.{$type}",
                'severity' => $severity,
                'title' => $title,
                'message' => $message,
                'source_type' => 'product',
                'source_id' => $product->id,
                'action' => 'view_product',
                // لقطة كمّية للسياق فقط — لا تكلفة ولا سعر شراء إطلاقاً.
                'data' => [
                    'quantity_on_hand' => $product->quantity_on_hand,
                    'reorder_level' => $product->reorder_level,
                ],
                'dedupe_key' => $dedupeKey,
            ]);
        }
    }

    /**
     * مستلمون محافظون: مستخدمو المستأجر النشطون الذين يملكون `products.manage`
     * (من يتصرّف بإعادة الطلب فعلاً، لا كل من يستطيع فقط عرض المنتجات)، مع
     * احترام رؤية الفرع — منتج بفرع محدَّد لا يصل مستخدماً مقيَّداً بفرعٍ آخر.
     * `branch_id` فارغ (منتج مشترك) يصل الجميع، بنفس اصطلاح
     * `ApiController::scopeToActiveBranch` (`branch_id IS NULL` مرئي للكل).
     *
     * @return Collection<int, User>
     */
    private function resolveRecipients(string $tenantId, Product $product): Collection
    {
        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->get()
            ->filter(fn (User $user): bool => $user->hasPermission('products.manage')
                && ($product->branch_id === null || $user->canAccessBranch($product->branch_id)))
            ->values();
    }
}
