<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * تخصيص جزء من استرداد المورّد على مرتجع مشتريات مرحّل.
 *
 * جدولٌ مستقل عمداً عن `payment_allocations`: عقد ذاك فاتورة مبيعات أو
 * فاتورة مشتريات، وهذا مرتجعُ مشترياتٍ حصراً. صفوفه تبقى بعد العكس
 * (تاريخٌ لا يُحذف)، لكن تخصيصات الاسترداد المعكوس لا تُحسب في الرصيد
 * القابل للاسترداد.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: تخصيص تابع لمستند — يتبع فرع رأسه */
class SupplierRefundAllocation extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'supplier_refund_id', 'purchase_return_id', 'amount',
    ];

    protected $casts = [
        'amount' => 'integer',
    ];

    public function supplierRefund(): BelongsTo
    {
        return $this->belongsTo(SupplierRefund::class);
    }

    public function purchaseReturn(): BelongsTo
    {
        return $this->belongsTo(ReturnDocument::class, 'purchase_return_id');
    }
}
