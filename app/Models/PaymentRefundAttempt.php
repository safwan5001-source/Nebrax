<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * سجل استدعاء مزوّد لاسترداد (ADR-0007 §4.1/§5-3): يُدرج **قبل** الاتصال بالمزوّد ولا يتغيّر أبداً (append-only في النموذج والقاعدة)؛ يحمل خط الأساس
 * التراكمي لدى المزوّد. النتيجة سجل منفصل (`PaymentRefundAttemptResult`). مستند فرعي تابع لرأسه.
 */
class PaymentRefundAttempt extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = ['payment_refund_id', 'seq', 'baseline_refunded_minor', 'amount_minor'];

    protected function casts(): array
    {
        return ['seq' => 'integer', 'baseline_refunded_minor' => 'integer', 'amount_minor' => 'integer'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $attempt): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment refund attempts.');
            }
            $attempt->tenant_id = (string) $context->id();
            if ((int) $attempt->amount_minor <= 0 || (int) $attempt->baseline_refunded_minor < 0 || (int) $attempt->seq < 1) {
                throw new DomainException('Payment refund attempt amounts are invalid.');
            }
            if (! PaymentRefund::query()->whereKey($attempt->payment_refund_id)->exists()) {
                throw new DomainException('Refund attempt refund must belong to the active tenant.');
            }
        });
        static::updating(fn () => throw new LogicException('Payment refund attempts are append-only.'));
        static::deleting(fn () => throw new LogicException('Payment refund attempts are append-only.'));
    }

    public function paymentRefund(): BelongsTo
    {
        return $this->belongsTo(PaymentRefund::class);
    }

    public function results(): HasMany
    {
        return $this->hasMany(PaymentRefundAttemptResult::class, 'payment_refund_attempt_id');
    }
}
