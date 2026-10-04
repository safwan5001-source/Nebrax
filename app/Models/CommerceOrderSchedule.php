<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * FLOWERS-H7b / ADR-19 — لقطة موعد التسليم الثابتة للطلب (الطريقة، التاريخ، تسمية النافذة وأوقاتها، المنطقة الزمنية).
 * حجّة تاريخية: لا إنشاء/تعديل/حذف بعد تأكيد الطلب و`commerce_order_id` غير قابل لإعادة الربط (نمط
 * `CommerceOrderGift`). `commerce_delivery_slot_id` مرجعٌ لعدّ السعة فقط (`nullOnDelete`) — اللقطة لا تعتمد عليه.
 */
class CommerceOrderSchedule extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'commerce_order_id', 'method', 'delivery_date', 'commerce_delivery_slot_id',
        'slot_label', 'slot_label_en', 'start_time', 'end_time', 'timezone',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $schedule): void {
            self::rejectIfOwningOrderIsConfirmed($schedule, 'لا يمكن إنشاء لقطة موعد لطلب مؤكَّد — تُلتقط وقت الطلب فقط.');
        });

        static::updating(function (self $schedule): void {
            if ($schedule->isDirty('commerce_order_id')) {
                throw new LogicException('لا يمكن إعادة ربط لقطة الموعد بطلبٍ آخر.');
            }

            // الفكّ الآلي لمرجع النافذة عند حذفها (nullOnDelete) يتمّ في قاعدة البيانات لا عبر Eloquent؛ أي تعديل
            // تطبيقي بعد التأكيد مرفوض.
            self::rejectIfOwningOrderIsConfirmed($schedule, 'لا يمكن تعديل لقطة موعد طلب مؤكَّد — لقطة تاريخية مجمَّدة.');
        });

        static::deleting(function (self $schedule): void {
            self::rejectIfOwningOrderIsConfirmed($schedule, 'لا يمكن حذف لقطة موعد طلب مؤكَّد — لقطة تاريخية مجمَّدة.');
        });
    }

    private static function rejectIfOwningOrderIsConfirmed(self $schedule, string $message): void
    {
        $order = $schedule->order()->first();
        if ($order !== null && $order->isConfirmed()) {
            throw new LogicException($message);
        }
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }
}
