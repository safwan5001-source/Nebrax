<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * استرداد عبر بوابة الدفع (PAY-H3-01b، ADR-0007 accepted): مستند مستقل عن `customer_refunds` — طلب ← اعتماد **مستقل** (الطالب ≠ المعتمِد، قرار المالك 4)
 * ← مزوّد ← (ترحيل A5 في 01c). **لا أثر مالي هنا**: لا قيد ولا سند؛ الترحيل لاحقاً عبر `LedgerService`.
 *
 * الانتقالات المشروعة في `TRANSITIONS` تُفرض هنا لكل مسار كتابة وتُعاد في القاعدة (مُشغّل). حقول الهوية والمبلغ ثابتة بعد الإنشاء؛ المعتمِد/الطالب
 * لا يتغيّران؛ لا حذف. تاريخ القيد المحاسبي = تاريخ لحظة التأكيد المحلي، وتاريخ المزوّد الأصلي يُحفظ في `provider_refunded_at` (قرار المالك 3).
 */
class PaymentRefund extends BaseModel
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    public const REQUESTED = 'requested';

    public const APPROVED = 'approved';

    public const REJECTED = 'rejected';

    public const CANCELLED = 'cancelled';

    public const SUBMITTING = 'submitting';

    public const CONFIRMED = 'confirmed';

    public const FAILED = 'failed';

    public const UNKNOWN = 'unknown';

    public const STATUSES = [
        self::REQUESTED, self::APPROVED, self::REJECTED, self::CANCELLED, self::SUBMITTING, self::CONFIRMED, self::FAILED, self::UNKNOWN,
    ];

    /** تحجز سعة الدفعة (جهة الدفعة): ما لم يُؤكَّد بعد — المؤكَّد داخل `refunded_minor` فلا يُخصم مرتين. */
    public const PAYMENT_RESERVING = [self::REQUESTED, self::APPROVED, self::SUBMITTING, self::UNKNOWN];

    /** تستهلك/تحجز رصيد المصدر التجاري (جهة المصدر): المؤكَّد (مرحَّل أو محجوب) لأن المال خرج فعلاً. */
    public const SOURCE_CONSUMING = [self::REQUESTED, self::APPROVED, self::SUBMITTING, self::UNKNOWN, self::CONFIRMED];

    public const POSTING_PENDING = 'pending';

    public const POSTING_POSTED = 'posted';

    public const POSTING_BLOCKED_PERIOD = 'blocked_period';

    /** @var array<string, list<string>> */
    public const TRANSITIONS = [
        self::REQUESTED => [self::APPROVED, self::REJECTED, self::CANCELLED],
        self::APPROVED => [self::SUBMITTING, self::CANCELLED],
        // submitting → approved: انهيار قبل سجل الاستدعاء أو أساس مجلوب يكشف استرداداً خارجياً (لم يُرسَل شيء).
        self::SUBMITTING => [self::CONFIRMED, self::FAILED, self::UNKNOWN, self::APPROVED],
        // unknown → approved: إعادة إرسال واحدة مبرَّرة بالدليل (retry_count ≤ 1).
        self::UNKNOWN => [self::CONFIRMED, self::FAILED, self::APPROVED],
        self::REJECTED => [],
        self::CANCELLED => [],
        self::CONFIRMED => [],
        self::FAILED => [],
    ];

    /** @var array<string, list<string>> ترحيل A5: pending ← posted | blocked_period؛ blocked_period ← posted (R10)؛ المرحَّل نهائي. */
    public const POSTING_TRANSITIONS = [
        '' => [self::POSTING_PENDING],
        self::POSTING_PENDING => [self::POSTING_POSTED, self::POSTING_BLOCKED_PERIOD],
        self::POSTING_BLOCKED_PERIOD => [self::POSTING_POSTED],
        self::POSTING_POSTED => [],
    ];

    private const IMMUTABLE = [
        'tenant_id', 'number', 'partner_id', 'payment_attempt_id', 'payment_gateway_id', 'amount_minor', 'currency',
        'requested_by', 'requested_at', 'idempotency_key',
    ];

    protected $fillable = [
        'tenant_id', 'branch_id', 'number', 'partner_id', 'payment_attempt_id', 'payment_gateway_id', 'amount_minor', 'currency',
        'idempotency_key', 'requested_by', 'requested_at',
    ];

    protected $attributes = [
        'status' => self::REQUESTED,
        'retry_count' => 0,
        'excess_minor' => 0,
    ];

    protected function casts(): array
    {
        return [
            'amount_minor' => 'integer',
            'provider_refunded_minor' => 'integer',
            'retry_count' => 'integer',
            'excess_minor' => 'integer',
            'requested_at' => 'datetime',
            'approved_at' => 'datetime',
            'rejected_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'provider_refunded_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'posted_at' => 'datetime',
            'accounting_date' => 'date:Y-m-d',
            'posting_blocked_reason' => 'array',
        ];
    }

    public static function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    protected static function booted(): void
    {
        static::creating(function (self $refund): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment refunds.');
            }
            $tenantId = (string) $context->id();
            if ($refund->tenant_id !== null && (string) $refund->tenant_id !== $tenantId) {
                throw new DomainException('Payment refund tenant cannot be forged.');
            }
            $refund->tenant_id = $tenantId;
            if ($refund->status !== self::REQUESTED || (int) $refund->amount_minor <= 0) {
                throw new DomainException('Payment refund must start as requested with a positive amount.');
            }
            // المحاولة والبوابة والعميل تُحلّ بنطاق المستأجر: مراجع مستأجر آخر غير موجودة هنا.
            if (! PaymentAttempt::query()->whereKey($refund->payment_attempt_id)->exists()
                || ! PaymentGateway::query()->whereKey($refund->payment_gateway_id)->exists()
                || ! Partner::query()->whereKey($refund->partner_id)->exists()) {
                throw new DomainException('Payment refund references must belong to the active tenant.');
            }
        });

        static::updating(function (self $refund): void {
            foreach (self::IMMUTABLE as $field) {
                if ($refund->isDirty($field)) {
                    throw new LogicException("Payment refund field [{$field}] is immutable.");
                }
            }
            foreach (['approved_by', 'approved_at', 'confirmed_at', 'provider_refunded_at', 'journal_entry_id', 'accounting_date', 'posted_at'] as $field) {
                if ($refund->isDirty($field) && $refund->getOriginal($field) !== null) {
                    throw new LogicException("Payment refund field [{$field}] is immutable once recorded.");
                }
            }
            if ($refund->isDirty('posting_status')) {
                $from = (string) $refund->getOriginal('posting_status');
                $to = (string) $refund->posting_status;
                if (! in_array($to, self::POSTING_TRANSITIONS[$from] ?? [], true)) {
                    throw new LogicException("Illegal payment refund posting transition {$from} → {$to}.");
                }
            }
            if ($refund->isDirty('status')) {
                $from = (string) $refund->getOriginal('status');
                $to = (string) $refund->status;
                if (! self::canTransition($from, $to)) {
                    throw new LogicException("Illegal payment refund transition {$from} → {$to}.");
                }
            }
        });

        static::deleting(fn () => throw new LogicException('Payment refunds are financial records and are never deleted.'));
    }

    public function isInFlight(): bool
    {
        return in_array($this->status, [self::SUBMITTING, self::UNKNOWN], true);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(PaymentRefundAllocation::class);
    }

    public function attempts(): HasMany
    {
        return $this->hasMany(PaymentRefundAttempt::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(PaymentRefundEvent::class);
    }

    public function paymentAttempt(): BelongsTo
    {
        return $this->belongsTo(PaymentAttempt::class, 'payment_attempt_id');
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(PaymentGateway::class, 'payment_gateway_id');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }
}
