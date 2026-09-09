<?php

namespace App\Services\Commerce;

use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Inventory Reservation — أول primitive حجز حقيقي (PR-COM-1B، ADR-02)
 * ═══════════════════════════════════════════════════════════════
 *
 * الحجز **وعدٌ تشغيلي لا حركة مخزون**: لا يستدعي هذا الصنف أي طريقة من
 * `LedgerService`/`InventoryService` ولا ينشئ `StockMovement` ولا يغيّر
 * `products.quantity_on_hand`/`avg_cost` ولا `product_warehouse_stock.quantity`
 * — القفل عليها للتزامن فقط، بلا كتابة. راجع `App\Support\CommerceBoundary`.
 *
 * **الحساب الذرّي (acquire):** يقرأ On Hand من `product_warehouse_stock` عبر
 * `lockForUpdate()` — نفس صفّ`(product_id, warehouse_id)` المرشَّح طبيعياً
 * (له `unique(['product_id','warehouse_id'])` أصلاً)، فيصبح نقطة تسلسلٍ
 * حقيقية: معاملتان متزامنتان لنفس المنتج/المخزن تتسلسلان عبره، فتقرأ الثانية
 * مجموع المحجوز النشط **بعد** التزام الأولى، لا قبله. منتجٌ بلا صفّ في هذا
 * الجدول يعني On Hand = صفر يقيناً (لا حركة مخزون سجّلت له شيئاً بعد)، فلا
 * حاجة لإنشاء الصفّ أو قفله — أي كمية مطلوبة > صفر تُرفض حتماً بصرف النظر
 * عن التزامن، فالتماس القفل هنا غير ضروري ولا آمن (كان سيحتاج `firstOrCreate`
 * يتنافس هو نفسه على القيد الفريد).
 *
 * **بوابة idempotency:** القيد الفريد `(tenant_id, idempotency_key)` على
 * `inventory_reservations` (نفس نمط `pos_checkout_attempts`). طلبان متزامنان
 * بالمفتاح نفسه: أحدهما يفوز بالإدراج، والآخر يصطدم بالقيد
 * (`QueryException` تُلتقَط **خارج** `DB::transaction()` — الالتقاط داخلها
 * كان سيترك معاملة PostgreSQL «مُجهَضة» فيفشل أي استعلامٍ تالٍ بلا فائدة،
 * تماماً كما في `PosService::checkout()`)، فيُعاد قراءة الفائز والتحقّق من
 * تطابق البصمة (`hash_equals`) قبل إرجاعه — إعادة تشغيل آمنة، لا حجزٌ مضاعَف.
 * بصمةٌ غير مطابقة (منتج/مخزن/كمية/مصدر مختلف بنفس المفتاح) تُرفض صراحةً.
 *
 * **العزل:** كل استعلام هنا يمرّ عبر `InventoryReservation`/`Product`/
 * `Warehouse`/`ProductWarehouseStock` — جميعها `BaseModel` فتُصفّى تلقائياً
 * بـ`TenantScope`. لا `tenant_id` يُقبل من المستدعي، ولا أي تجاوز لـ
 * `TenantScope` في هذا الملف. تجاوز `BranchScope` الوحيد (على وجود المنتج)
 * يطابق حرفياً سبب `AvailableToSellService::forWarehouse()` نفسه: الحجز
 * لمخزنٍ مُسمّى صراحةً، لا للفرع النشط العابر لسياق الطلب.
 */
final class InventoryReservationService
{
    /**
     * @throws RuntimeException كمية غير صالحة، أو منتج/مخزن غير موجودين لمستأجر السياق الحالي.
     * @throws InsufficientAvailabilityException الكمية المتاحة للبيع أقل من المطلوب.
     * @throws InventoryReservationIdempotencyConflictException نفس المفتاح بحمولة مادية مختلفة.
     */
    public function acquire(
        string $productId,
        string $warehouseId,
        int $baseQuantity,
        string $idempotencyKey,
        ?string $sourceType = null,
        ?string $sourceId = null,
    ): InventoryReservation {
        if ($baseQuantity <= 0) {
            throw new RuntimeException('كمية الحجز يجب أن تكون أكبر من صفر.');
        }

        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط لإجراء الحجز.');
        }

        $checksum = self::checksum($productId, $warehouseId, $baseQuantity, $sourceType, $sourceId);

        try {
            return DB::transaction(function () use (
                $productId, $warehouseId, $baseQuantity, $idempotencyKey, $sourceType, $sourceId, $tenantId, $checksum,
            ) {
                $existing = InventoryReservation::query()->where('idempotency_key', $idempotencyKey)->first();
                if ($existing !== null) {
                    $this->assertChecksumMatches($existing, $checksum);

                    return $existing;
                }

                if (! Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($productId)->exists()) {
                    throw new RuntimeException('المنتج غير موجود.');
                }
                if (! Warehouse::whereKey($warehouseId)->exists()) {
                    throw new RuntimeException('المخزن غير موجود.');
                }

                // نقطة التسلسل الذرّية: انظر توضيح الصنف أعلاه.
                $stockRow = ProductWarehouseStock::query()
                    ->where('product_id', $productId)
                    ->where('warehouse_id', $warehouseId)
                    ->lockForUpdate()
                    ->first();
                $onHand = (int) ($stockRow->quantity ?? 0);

                $activeReserved = $this->activeReservedQuantity($productId, $warehouseId);
                $available = max(0, $onHand - $activeReserved);

                if ($available < $baseQuantity) {
                    throw new InsufficientAvailabilityException(sprintf(
                        'الكمية المتاحة للبيع (%d) أقل من المطلوب حجزه (%d).',
                        $available,
                        $baseQuantity,
                    ));
                }

                return InventoryReservation::create([
                    'tenant_id' => $tenantId,
                    'warehouse_id' => $warehouseId,
                    'product_id' => $productId,
                    'base_quantity' => $baseQuantity,
                    'status' => InventoryReservation::STATUS_ACTIVE,
                    'source_type' => $sourceType,
                    'source_id' => $sourceId,
                    'idempotency_key' => $idempotencyKey,
                    'request_checksum' => $checksum,
                ]);
            });
        } catch (QueryException $e) {
            if (! $this->isUniqueConstraintViolation($e)) {
                throw $e;
            }

            // سباق idempotency خسرناه: القيد الفريد يمنع الصفّ المكرَّر — نعيد
            // قراءة الفائز بدل فشل الطلب، فتبقى إعادة المحاولة آمنة.
            $existing = InventoryReservation::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing === null) {
                throw $e;
            }
            $this->assertChecksumMatches($existing, $checksum);

            return $existing;
        }
    }

    /** ACTIVE → RELEASED. إعادة الاستدعاء على حجزٍ مُفرَجٍ عنه بالفعل آمنة (لا تحويل مضاعَف). */
    public function release(string $reservationId): InventoryReservation
    {
        return $this->transition($reservationId, InventoryReservation::STATUS_RELEASED, 'released_at');
    }

    /**
     * ACTIVE → CONSUMED. **لا** ينشئ `StockMovement`: هذا فقط ينهي وعد
     * الحجز؛ حركة المخزون الفعلية تصدر من سلطة الإتمام المناسبة لاحقاً.
     */
    public function consume(string $reservationId): InventoryReservation
    {
        return $this->transition($reservationId, InventoryReservation::STATUS_CONSUMED, 'consumed_at');
    }

    /**
     * ACTIVE → EXPIRED. عملية domain صريحة فقط — لا مُجدوِل/طابور ينفّذها
     * تلقائياً في هذه المرحلة (خارج نطاق COM-1B عمداً).
     */
    public function expire(string $reservationId): InventoryReservation
    {
        return $this->transition($reservationId, InventoryReservation::STATUS_EXPIRED, 'expired_at');
    }

    /**
     * مجموع الحجوزات النشطة لمنتج × مخزن — يستهلكه `AvailableToSellService`
     * حصراً كمصدر `activeReserved`. لا عدّاد مجمَّع مخزَّن يوازيه.
     */
    public function activeReservedQuantity(string $productId, string $warehouseId): int
    {
        return (int) InventoryReservation::query()
            ->where('product_id', $productId)
            ->where('warehouse_id', $warehouseId)
            ->where('status', InventoryReservation::STATUS_ACTIVE)
            ->sum('base_quantity');
    }

    /**
     * @throws InvalidReservationStateTransitionException الحجز ليس ACTIVE ولا في الحالة الهدف أصلاً.
     */
    private function transition(string $reservationId, string $targetStatus, string $timestampColumn): InventoryReservation
    {
        return DB::transaction(function () use ($reservationId, $targetStatus, $timestampColumn) {
            $reservation = InventoryReservation::query()->lockForUpdate()->findOrFail($reservationId);

            if ($reservation->status === $targetStatus) {
                return $reservation; // إعادة محاولة آمنة — الحالة الهدف محقَّقة بالفعل.
            }

            if ($reservation->status !== InventoryReservation::STATUS_ACTIVE) {
                throw new InvalidReservationStateTransitionException(sprintf(
                    'لا يمكن الانتقال من حالة «%s» إلى «%s» — الانتقال مسموح فقط من active.',
                    $reservation->status,
                    $targetStatus,
                ));
            }

            $reservation->update([
                'status' => $targetStatus,
                $timestampColumn => now(),
            ]);

            return $reservation->fresh();
        });
    }

    private function assertChecksumMatches(InventoryReservation $existing, string $checksum): void
    {
        if (! hash_equals($existing->request_checksum, $checksum)) {
            throw new InventoryReservationIdempotencyConflictException(
                'تم استخدام مفتاح إعادة الطلب مع محتوى مختلف (منتج/مخزن/كمية/مصدر).'
            );
        }
    }

    private static function checksum(
        string $productId,
        string $warehouseId,
        int $baseQuantity,
        ?string $sourceType,
        ?string $sourceId,
    ): string {
        return hash('sha256', implode('|', [
            $productId, $warehouseId, (string) $baseQuantity, (string) $sourceType, (string) $sourceId,
        ]));
    }

    private function isUniqueConstraintViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? '');
        $driverCode = (int) ($e->errorInfo[1] ?? 0);

        // PostgreSQL unique_violation = 23505 · SQLite constraint = 19
        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }
}
