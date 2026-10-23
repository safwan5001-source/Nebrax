<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * تدقيق ثابت لكل انتقال وقرار بشري على الاسترداد، أو على الدفعة (`payment_refund_id` فارغ) لعلم الاسترداد الخارجي. الفاعل فارغ ⇒ مسار نظامي.
 * لا يكتب مالاً.
 */
class PaymentRefundEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = ['payment_refund_id', 'payment_attempt_id', 'action', 'from_status', 'to_status', 'actor_id', 'reason', 'meta'];

    protected function casts(): array
    {
        return ['meta' => 'array'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment refund events.');
            }
            $event->tenant_id = (string) $context->id();
            if (! PaymentAttempt::query()->whereKey($event->payment_attempt_id)->exists()) {
                throw new DomainException('Refund event attempt must belong to the active tenant.');
            }
            if ($event->payment_refund_id !== null && ! PaymentRefund::query()->whereKey($event->payment_refund_id)->exists()) {
                throw new DomainException('Refund event refund must belong to the active tenant.');
            }
        });
        static::updating(fn () => throw new LogicException('Payment refund events are append-only.'));
        static::deleting(fn () => throw new LogicException('Payment refund events are append-only.'));
    }

    public function paymentRefund(): BelongsTo
    {
        return $this->belongsTo(PaymentRefund::class);
    }
}
