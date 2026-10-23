<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * قرار بشري على التقاط محجوب بفترة مقفلة (PAY-H2-02d، ADR-0006 M5-R1): الفاعل والسبب والنتيجة. **ثابت** (append-only) في النموذج والقاعدة.
 * لا يكتب مالاً: الترحيل نفسه من `PaymentAttemptPostingService` عبر `PaymentService`.
 */
class PaymentAttemptPostingEvent extends BaseModel implements CompanyWide
{
    public const ACTION_REPOST = 'repost';

    public const OUTCOME_POSTED = 'posted';

    public const OUTCOME_STILL_BLOCKED = 'still_blocked';

    public const UPDATED_AT = null;

    protected $fillable = ['payment_attempt_id', 'action', 'outcome', 'actor_id', 'reason'];

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment attempt posting events.');
            }
            $event->tenant_id = (string) $context->id();
            if ($event->action !== self::ACTION_REPOST || ! in_array($event->outcome, [self::OUTCOME_POSTED, self::OUTCOME_STILL_BLOCKED], true)) {
                throw new DomainException('Posting event action/outcome is invalid.');
            }
            if (! PaymentAttempt::query()->whereKey($event->payment_attempt_id)->exists()) {
                throw new DomainException('Posting event attempt must belong to the active tenant.');
            }
        });

        static::updating(fn () => throw new LogicException('Payment attempt posting events are append-only.'));
        static::deleting(fn () => throw new LogicException('Payment attempt posting events are append-only.'));
    }

    public function attempt(): BelongsTo
    {
        return $this->belongsTo(PaymentAttempt::class, 'payment_attempt_id');
    }
}
