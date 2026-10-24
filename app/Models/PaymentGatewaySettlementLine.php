<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * بند غير تحصيلي في تسوية بوابة (PAY-H3-02b، ADR-0008): استرداد مخصوم من الصرف (A6). `CompanyWide` كترويسة التسوية.
 * ثابت بعد الإنشاء (يُستبدل البند بحذفه وإعادة إنشائه ما دامت التسوية `unreconciled`؛ القاعدة تمنع تعديله بعد الترحيل).
 */
class PaymentGatewaySettlementLine extends BaseModel implements CompanyWide
{
    public const TYPE_REFUND = 'refund';

    protected $fillable = [
        'tenant_id', 'settlement_id', 'line_type', 'payment_refund_id', 'amount_minor', 'provider_event_ref', 'evidence_ref', 'reason',
    ];

    protected $casts = ['amount_minor' => 'integer'];

    protected static function booted(): void
    {
        static::saving(function (self $line): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for gateway settlement lines.');
            }
            $tenantId = (string) $context->id();
            if ($line->tenant_id !== null && (string) $line->tenant_id !== $tenantId) {
                throw new DomainException('Gateway settlement line tenant cannot be forged.');
            }
            $line->tenant_id = $tenantId;
            if ($line->exists) {
                throw new DomainException('Gateway settlement lines are immutable.');
            }
        });

        // حذف بند مرحَّل يعيد مبلغه متاحاً للخصم مجدداً؛ تستبدل المسودة أبناءها عبر استعلام (القاعدة تحرس المرحَّل أيضاً).
        static::deleting(function (self $line): void {
            if (PaymentGatewaySettlement::query()->whereKey($line->settlement_id)->where('status', PaymentGatewaySettlement::STATUS_POSTED)->exists()) {
                throw new DomainException('Posted gateway settlement lines cannot be deleted.');
            }
        });
    }

    public function settlement(): BelongsTo
    {
        return $this->belongsTo(PaymentGatewaySettlement::class, 'settlement_id');
    }

    public function refund(): BelongsTo
    {
        return $this->belongsTo(PaymentRefund::class, 'payment_refund_id');
    }
}
