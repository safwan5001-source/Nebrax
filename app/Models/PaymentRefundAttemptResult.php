<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * نتيجة استدعاء استرداد (ADR-0007 §4.1): تُدرج بعد الاتصال ولا تتغيّر. `unknown` قد يتبعها صف نهائي واحد (`confirmed`/`rejected`) من المطابقة أو الحسم البشري.
 * `UNIQUE` جزئي في القاعدة: نتيجة نهائية واحدة ونتيجة unknown واحدة لكل استدعاء.
 */
class PaymentRefundAttemptResult extends BaseModel implements CompanyWide
{
    public const OUTCOME_CONFIRMED = 'confirmed';

    public const OUTCOME_REJECTED = 'rejected';

    public const OUTCOME_UNKNOWN = 'unknown';

    public const OUTCOMES = [self::OUTCOME_CONFIRMED, self::OUTCOME_REJECTED, self::OUTCOME_UNKNOWN];

    public const UPDATED_AT = null;

    protected $fillable = ['payment_refund_attempt_id', 'outcome', 'observed_refunded_minor', 'provider_ref', 'error_code', 'excess_minor'];

    protected $attributes = ['excess_minor' => 0];

    protected function casts(): array
    {
        return ['observed_refunded_minor' => 'integer', 'excess_minor' => 'integer'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $result): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment refund results.');
            }
            $result->tenant_id = (string) $context->id();
            if (! in_array($result->outcome, self::OUTCOMES, true) || (int) $result->excess_minor < 0) {
                throw new DomainException('Payment refund result outcome is invalid.');
            }
            if (! PaymentRefundAttempt::query()->whereKey($result->payment_refund_attempt_id)->exists()) {
                throw new DomainException('Refund result attempt must belong to the active tenant.');
            }
        });
        static::updating(fn () => throw new LogicException('Payment refund results are append-only.'));
        static::deleting(fn () => throw new LogicException('Payment refund results are append-only.'));
    }

    public function attempt(): BelongsTo
    {
        return $this->belongsTo(PaymentRefundAttempt::class, 'payment_refund_attempt_id');
    }
}
