<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\InventoryReservation;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Order Reservation Orchestration — PR-COM-5B (ADR-01/ADR-02)
 * ═══════════════════════════════════════════════════════════════
 *
 * يربط `CommerceOrder` مؤكَّداً بحجز مخزون حقيقي — **بلا** إعادة تنفيذ أي
 * منطق حجز/تزامن/idempotency: كل سطر يُحجز عبر
 * `InventoryReservationService::acquire()` حصراً (COM-1B)، والمخزن يُحسم
 * عبر `FulfillmentPolicyService::resolveWarehouseFor()` حصراً (COM-2B).
 * هذا الصنف ينسِّق فقط — لا يحسب ATS، لا يقفل صفوفاً، لا يبني مفتاح
 * idempotency جديداً من الصفر (يشتقّه فقط من هويات مستقرة).
 *
 * **السياسة غير مقرَّرة عمداً (ADR-02 §5)**: `ON_ORDER_CONFIRMATION` مقابل
 * `ON_PAYMENT_CONFIRMED` ليست محسومة بعد على مستوى Master Plan — لذلك هذا
 * الصنف **مستقل وصريح الاستدعاء**، لا يُستدعى تلقائياً من
 * `CommerceOrderService::confirm()`. أهليّة الحجز الوحيدة المحسومة الآن:
 * الطلب يجب أن يكون `confirmed` — ذلك الشرط الأدنى المشترك بين كل سياسة
 * زمنية محتملة، لا اختيار سياسة نهائية.
 *
 * **هوية المصدر**: `source_type`/`source_id` على `InventoryReservation`
 * تُملأ بـ`CommerceOrder::class`/`$order->id` — نفس اصطلاح
 * `journal_entries`/`stock_movements` تماماً (رأس المستند، لا سطره؛
 * مؤكَّدٌ عبر `InvoiceService`/`InventoryService` الفعليين: عدّة حركات
 * لسطور مختلفة تتشارك `source_id` الفاتورة نفسها).
 *
 * **مفتاح idempotency**: يُشتقّ حتمياً من `(order_id, line_id)` — كلاهما
 * ثابتان لا يتغيّران بعد الإنشاء (COM-5A لا يعدّل سطور القائمة). إعادة
 * محاولة orchestration لنفس الطلب تمرّر نفس المفاتيح، فتُعيد
 * `acquire()` نفسها الحجوزات القائمة (بصمتها تُطابَق) بدل تكرارها — بلا
 * إطار idempotency ثانٍ.
 *
 * **الذرّية على مستوى الطلب**: كل استدعاءات `acquire()` لسطور الطلب تقع
 * داخل معاملة واحدة تُغلِّف الجميع. `acquire()` تفتح معاملتها الداخلية
 * الخاصة (نقطة حفظ متداخلة تحت هذه المعاملة الخارجية في PostgreSQL
 * وSQLite معاً) — فشل سطرٍ لاحق (تعارض idempotency أو نقص إتاحة) يُسقط
 * المعاملة الخارجية بكاملها، فلا يبقى حجزٌ جزئي لأي سطرٍ سابقٍ نجح ضمن
 * نفس المحاولة.
 */
final class CommerceOrderReservationService
{
    public function __construct(
        private readonly InventoryReservationService $reservations,
        private readonly FulfillmentPolicyService $fulfillment,
    ) {}

    /**
     * يحجز كل سطور طلبٍ مؤكَّد ذرّياً عبر مخزن التنفيذ المحسوم لقناته.
     *
     * @return Collection<int, InventoryReservation>
     *
     * @throws RuntimeException الطلب غير موجود لمستأجر السياق الحالي، أو
     *                          ليس بحالة `confirmed`.
     * @throws FulfillmentPolicyNotConfiguredException لا مخزن تنفيذ صالحاً لقناة الطلب.
     * @throws InsufficientAvailabilityException الكمية المتاحة للبيع أقل من كمية سطرٍ ما.
     * @throws InventoryReservationIdempotencyConflictException إعادة محاولة بحمولة مختلفة.
     */
    public function reserve(CommerceOrder $order): Collection
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return DB::transaction(function () use ($order) {
            // إعادة تحميل مقفولة تحت TenantScope الحالي — لا ثقة بحالة
            // الكائن الممرَّر: مصدر الحقيقة الوحيد هو ما يراه السياق الموثوق.
            $order = CommerceOrder::query()->with('lines')->lockForUpdate()->find($order->id);
            if ($order === null) {
                throw new RuntimeException('الطلب غير موجود.');
            }

            if (! $order->isConfirmed()) {
                throw new RuntimeException('لا يمكن حجز طلبٍ غير مؤكَّد.');
            }

            // مخزنٌ واحد صريح لكل الطلب (ADR-03: V1 = fixed location) — لا
            // تقسيم بين مخازن متعددة، ولا استنتاج من فرع.
            $warehouse = $this->fulfillment->resolveWarehouseFor($order->sales_channel_id);

            return $order->lines->map(fn (CommerceOrderLine $line) => $this->reservations->acquire(
                productId: $line->product_id,
                warehouseId: $warehouse->id,
                baseQuantity: $line->baseQuantity(),
                idempotencyKey: $this->idempotencyKeyFor($order, $line),
                sourceType: CommerceOrder::class,
                sourceId: $order->id,
            ));
        });
    }

    /** كل الحجوزات المرتبطة بطلبٍ — قراءة مباشرة على المرجع العام، لا علاقة Eloquent جديدة (لا سابقة لها). */
    public function reservationsFor(CommerceOrder $order): Collection
    {
        return InventoryReservation::query()
            ->where('source_type', CommerceOrder::class)
            ->where('source_id', $order->id)
            ->get();
    }

    private function idempotencyKeyFor(CommerceOrder $order, CommerceOrderLine $line): string
    {
        return "commerce-order-reservation:{$order->id}:{$line->id}";
    }
}
