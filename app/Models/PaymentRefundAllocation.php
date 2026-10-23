<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use LogicException;

/**
 * تخصيص جزء من استرداد البوابة على تصحيح تجاري مرحّل (إشعار دائن آجل أو مرتجع مبيعات آجل)، بنمط `CustomerRefundAllocation`. **Σ التخصيصات = مبلغ الاسترداد**
 * (يُفرض في الخدمة وفي القاعدة عند الاعتماد). ثابت بعد مغادرة المستند حالة `requested`. تابع لمستند فرعي فيتبع فرع رأسه.
 *
 * @see design-system/foundations/multi-branch-architecture.md — مشترك: تخصيص تابع لمستند
 */
class PaymentRefundAllocation extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'payment_refund_id', 'source_type', 'source_id', 'amount_minor'];

    protected function casts(): array
    {
        return ['amount_minor' => 'integer'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $allocation): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment refund allocations.');
            }
            $allocation->tenant_id = (string) $context->id();
            if ((int) $allocation->amount_minor <= 0 || ! in_array($allocation->source_type, [CreditNote::class, ReturnDocument::class], true)) {
                throw new DomainException('Payment refund allocation amount/source is invalid.');
            }
            if (! PaymentRefund::query()->whereKey($allocation->payment_refund_id)->exists()) {
                throw new DomainException('Allocation refund must belong to the active tenant.');
            }
        });
        static::updating(fn () => throw new LogicException('Payment refund allocations are immutable.'));
        static::deleting(fn () => throw new LogicException('Payment refund allocations are immutable.'));
    }

    public function paymentRefund(): BelongsTo
    {
        return $this->belongsTo(PaymentRefund::class);
    }

    public function source(): MorphTo
    {
        return $this->morphTo();
    }
}
