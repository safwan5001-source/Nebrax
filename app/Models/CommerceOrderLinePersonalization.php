<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * FLOWERS-H4b / ADR-16 — لقطة تخصيص ثابتة لسطر طلب. نفس نمط حراسة `CommerceOrderSnapshot`:
 * لا إنشاء/تعديل/حذف بعد تأكيد الطلب، وربط السطر غير قابل لإعادة الإسناد.
 */
class CommerceOrderLinePersonalization extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'commerce_order_line_id', 'field_key', 'field_type', 'label', 'label_en', 'value', 'value_label', 'sort_order'];

    protected $casts = ['sort_order' => 'integer'];

    protected static function booted(): void
    {
        static::creating(function (self $row): void {
            self::rejectIfConfirmed($row, 'لا يمكن إنشاء لقطة تخصيص لطلب مؤكَّد — تُلتقط وقت الطلب فقط.');
        });
        static::updating(function (self $row): void {
            if ($row->isDirty('commerce_order_line_id')) {
                throw new LogicException('لا يمكن إعادة ربط لقطة التخصيص بسطرٍ آخر.');
            }
            self::rejectIfConfirmed($row, 'لا يمكن تعديل لقطة تخصيص طلب مؤكَّد — لقطة تاريخية مجمَّدة.');
        });
        static::deleting(function (self $row): void {
            self::rejectIfConfirmed($row, 'لا يمكن حذف لقطة تخصيص طلب مؤكَّد — لقطة تاريخية مجمَّدة.');
        });
    }

    private static function rejectIfConfirmed(self $row, string $message): void
    {
        $order = $row->line()->first()?->order()->first();
        if ($order !== null && $order->isConfirmed()) {
            throw new LogicException($message);
        }
    }

    public function line(): BelongsTo
    {
        return $this->belongsTo(CommerceOrderLine::class, 'commerce_order_line_id');
    }
}
