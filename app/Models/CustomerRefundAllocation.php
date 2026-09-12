<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * تخصيص جزء من استرداد العميل على تصحيح تجاري مرحّل أنشأ رصيد عميل.
 *
 * الأهداف المسموحة: مرتجع مبيعات آجل (`ReturnDocument` type=sales,
 * payment_type=credit) أو إشعار دائن آجل (`CreditNote` type=sales,
 * refund_type=credit). جدولٌ مستقل عمداً عن `payment_allocations` وعن
 * `supplier_refund_allocations`. صفوفه تبقى بعد العكس (تاريخٌ لا يُحذف)،
 * لكن تخصيصات الاسترداد المعكوس لا تُحسب في الرصيد القابل للاسترداد.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: تخصيص تابع لمستند — يتبع فرع رأسه */
class CustomerRefundAllocation extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'customer_refund_id', 'source_type', 'source_id', 'amount',
    ];

    protected $casts = [
        'amount' => 'integer',
    ];

    public function customerRefund(): BelongsTo
    {
        return $this->belongsTo(CustomerRefund::class);
    }

    public function source(): MorphTo
    {
        return $this->morphTo();
    }
}
