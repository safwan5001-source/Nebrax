<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * FLOWERS-H3 / ADR-15 — لقطة الإهداء الثابتة للطلب. حجّة تاريخية مستقلة عن
 * `Partner`/`CustomerIdentity`: لا هوية محاسبية ولا تفويض. نفس نمط حراسة
 * `CommerceOrderSnapshot`: لا إنشاء/تعديل/حذف بعد تأكيد الطلب، و
 * `commerce_order_id` غير قابل لإعادة الربط بنيوياً.
 */
class CommerceOrderGift extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'commerce_order_id', 'recipient_name', 'recipient_phone', 'sender_display_name', 'hide_sender', 'message'];

    protected $casts = ['hide_sender' => 'boolean'];

    protected $attributes = ['hide_sender' => false];

    protected static function booted(): void
    {
        static::creating(function (self $gift): void {
            self::rejectIfOwningOrderIsConfirmed($gift, 'لا يمكن إنشاء لقطة إهداء لطلب مؤكَّد — تُلتقط وقت الطلب فقط.');
        });

        static::updating(function (self $gift): void {
            if ($gift->isDirty('commerce_order_id')) {
                throw new LogicException('لا يمكن إعادة ربط لقطة الإهداء بطلبٍ آخر.');
            }

            self::rejectIfOwningOrderIsConfirmed($gift, 'لا يمكن تعديل لقطة إهداء طلب مؤكَّد — لقطة تاريخية مجمَّدة.');
        });

        static::deleting(function (self $gift): void {
            self::rejectIfOwningOrderIsConfirmed($gift, 'لا يمكن حذف لقطة إهداء طلب مؤكَّد — لقطة تاريخية مجمَّدة.');
        });
    }

    private static function rejectIfOwningOrderIsConfirmed(self $gift, string $message): void
    {
        $order = $gift->order()->first();
        if ($order !== null && $order->isConfirmed()) {
            throw new LogicException($message);
        }
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }
}
