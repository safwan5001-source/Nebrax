<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سطر في مجموعة ترحيل التقاط محاولة دفع (PAY-H2-02a، ADR-0006 M1–M4): يربط المحاولة بسند القبض الذي ولّدته `PaymentService`.
 * `UNIQUE(payment_attempt_id, role)` في القاعدة يمنع سندين لدور واحد (الترحيل المزدوج)، و`UNIQUE(payment_id)` يمنع تقاسم سند. سجل ربط
 * **ثابت** (append-only): لا تعديل ولا حذف. لا يكتب قيداً بنفسه؛ السند والقيد من `PaymentService` حصراً.
 */
class PaymentAttemptPosting extends BaseModel implements CompanyWide
{
    public const ROLE_ALLOCATED = 'allocated';

    public const ROLE_EXCESS = 'excess';

    public const ROLES = [self::ROLE_ALLOCATED, self::ROLE_EXCESS];

    public const UPDATED_AT = null;

    protected $fillable = ['payment_attempt_id', 'role', 'payment_id', 'amount_minor'];

    protected function casts(): array
    {
        return ['amount_minor' => 'integer'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $posting): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment attempt postings.');
            }
            $posting->tenant_id = (string) $context->id();

            if (! in_array($posting->role, self::ROLES, true) || (int) $posting->amount_minor <= 0) {
                throw new DomainException('Payment attempt posting role/amount is invalid.');
            }
            // المحاولة والسند يُحلّان بنطاق المستأجر: لا ربط عبر مستأجرين.
            if (! PaymentAttempt::query()->whereKey($posting->payment_attempt_id)->exists()) {
                throw new DomainException('Posting attempt must belong to the active tenant.');
            }
            if (! Payment::query()->whereKey($posting->payment_id)->exists()) {
                throw new DomainException('Posting payment must belong to the active tenant.');
            }
        });

        static::updating(fn () => throw new LogicException('Payment attempt postings are append-only.'));
        static::deleting(fn () => throw new LogicException('Payment attempt postings are append-only.'));
    }

    public function attempt(): BelongsTo
    {
        return $this->belongsTo(PaymentAttempt::class, 'payment_attempt_id');
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }
}
