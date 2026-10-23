<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * محاولة دفع إلكتروني واحدة لـ Payable عبر اتصال بوابة (PAY-H1-03). CompanyWide + `branch_id` لقطة (D-07).
 *
 * **ليست أثراً مالياً**: لا قيد ولا سند ولا تخصيص — هذه حالة تنسيق مع المزوّد فقط. الترحيل شريحة لاحقة
 * ويمرّ عبر `PaymentService`/`LedgerService`.
 *
 * `capture_status` رتيب: الانتقالات المسموحة وحدها في `TRANSITIONS` وتُفرض هنا لكل مسار كتابة (`updating`).
 * الاستثناء الوحيد المقصود: التقاط يؤكده المزوّد بعد إلغاء/انتهاء محلي يُقبل (D-15) ويُرفع للمراجعة.
 * حقول الهوية والمبلغ والمرجع لا تتغيّر بعد تثبيتها؛ المحاولة لا تُحذف.
 */
class PaymentAttempt extends BaseModel implements CompanyWide
{
    public const STATUS_CREATED = 'created';

    public const STATUS_PENDING_CUSTOMER = 'pending_customer';

    public const STATUS_AUTHORIZED = 'authorized';

    public const STATUS_CAPTURED = 'captured';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_EXPIRED = 'expired';

    public const STATUS_FAILED = 'failed';

    public const STATUS_VOIDED = 'voided';

    public const STATUSES = [
        self::STATUS_CREATED, self::STATUS_PENDING_CUSTOMER, self::STATUS_AUTHORIZED, self::STATUS_CAPTURED,
        self::STATUS_CANCELLED, self::STATUS_EXPIRED, self::STATUS_FAILED, self::STATUS_VOIDED,
    ];

    /** محاولة نشطة = تحجز الـ Payable (واحدة لكل Payable). */
    public const ACTIVE_STATUSES = [self::STATUS_CREATED, self::STATUS_PENDING_CUSTOMER, self::STATUS_AUTHORIZED];

    public const DISPUTE_NONE = 'none';

    public const REVIEW_LATE_CAPTURE = 'late_capture';

    public const REVIEW_AMOUNT_MISMATCH = 'amount_mismatch';

    public const REVIEW_CURRENCY_MISMATCH = 'currency_mismatch';

    public const REVIEW_STATE_CONFLICT = 'state_conflict';

    /** دفعة زائدة على المتبقي رُحّل فائضها كرصيد دائن غير مخصص (D-26، ADR-0006 M3). */
    public const REVIEW_OVERPAYMENT = 'overpayment';

    /** حالة ترحيل الالتقاط (ADR-0006): null قبل الالتقاط. pending ← posted | blocked_period | not_postable؛ blocked_period ← posted (R1). */
    public const POSTING_PENDING = 'pending';

    public const POSTING_POSTED = 'posted';

    public const POSTING_BLOCKED_PERIOD = 'blocked_period';

    public const POSTING_NOT_POSTABLE = 'not_postable';

    public const POSTING_STATUSES = [self::POSTING_PENDING, self::POSTING_POSTED, self::POSTING_BLOCKED_PERIOD, self::POSTING_NOT_POSTABLE];

    /** @var array<string, list<string|null>> */
    public const POSTING_TRANSITIONS = [
        '' => [self::POSTING_PENDING],
        self::POSTING_PENDING => [self::POSTING_POSTED, self::POSTING_BLOCKED_PERIOD, self::POSTING_NOT_POSTABLE],
        self::POSTING_BLOCKED_PERIOD => [self::POSTING_POSTED],
        self::POSTING_POSTED => [],
        self::POSTING_NOT_POSTABLE => [],
    ];

    /** @var array<string, list<string>> */
    public const TRANSITIONS = [
        self::STATUS_CREATED => [self::STATUS_PENDING_CUSTOMER, self::STATUS_CANCELLED, self::STATUS_FAILED, self::STATUS_EXPIRED],
        self::STATUS_PENDING_CUSTOMER => [self::STATUS_AUTHORIZED, self::STATUS_CAPTURED, self::STATUS_CANCELLED, self::STATUS_FAILED, self::STATUS_EXPIRED],
        self::STATUS_AUTHORIZED => [self::STATUS_CAPTURED, self::STATUS_VOIDED, self::STATUS_FAILED, self::STATUS_EXPIRED],
        // D-15: المزوّد يؤكد التقاطاً بعد قرار محلي بالإلغاء/الانتهاء — حقيقة تُقبل وتُرفع للمراجعة.
        self::STATUS_EXPIRED => [self::STATUS_CAPTURED],
        self::STATUS_CANCELLED => [self::STATUS_CAPTURED],
        self::STATUS_CAPTURED => [],
        self::STATUS_FAILED => [],
        self::STATUS_VOIDED => [],
    ];

    /** حقول تُثبَّت عند الإنشاء ولا تتغيّر. */
    private const IMMUTABLE = [
        'tenant_id', 'branch_id', 'payment_gateway_id', 'provider', 'environment', 'payable_key',
        'idempotency_key', 'amount_minor', 'currency', 'created_by',
    ];

    protected $fillable = [
        'tenant_id', 'branch_id', 'payment_gateway_id', 'provider', 'environment', 'payable_key', 'idempotency_key',
        'amount_minor', 'currency', 'created_by',
    ];

    protected $attributes = [
        'capture_status' => self::STATUS_CREATED,
        'dispute_status' => self::DISPUTE_NONE,
        'captured_minor' => 0,
        'refunded_minor' => 0,
    ];

    protected function casts(): array
    {
        return [
            'amount_minor' => 'integer',
            'captured_minor' => 'integer',
            'refunded_minor' => 'integer',
            'review_reasons' => 'array',
            'expires_at' => 'datetime',
            'captured_at' => 'datetime',
            'last_synced_at' => 'datetime',
            'accounting_date' => 'date:Y-m-d',
            'posting_blocked_reason' => 'array',
            'posted_at' => 'datetime',
        ];
    }

    public static function canTransitionPosting(?string $from, ?string $to): bool
    {
        return $to !== null && in_array($to, self::POSTING_TRANSITIONS[(string) $from] ?? [], true);
    }

    public static function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    protected static function booted(): void
    {
        static::creating(function (self $attempt): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment attempts.');
            }
            $tenantId = (string) $context->id();
            if ($attempt->tenant_id !== null && (string) $attempt->tenant_id !== $tenantId) {
                throw new DomainException('Payment attempt tenant cannot be forged.');
            }
            $attempt->tenant_id = $tenantId;

            // الاتصال يُحلّ عبر نطاق المستأجر: اتصال مستأجر آخر غير موجود هنا.
            if (! PaymentGateway::query()->whereKey($attempt->payment_gateway_id)->exists()) {
                throw new DomainException('Payment attempt gateway must belong to the active tenant.');
            }
            $attempt->branch_id ??= app(BranchContext::class)->id();
        });

        static::updating(function (self $attempt): void {
            foreach (self::IMMUTABLE as $field) {
                if ($attempt->isDirty($field)) {
                    throw new LogicException("Payment attempt field [{$field}] is immutable.");
                }
            }
            if ($attempt->isDirty('provider_payment_id') && $attempt->getOriginal('provider_payment_id') !== null) {
                throw new LogicException('Payment attempt provider reference is immutable once set.');
            }
            if ($attempt->isDirty('captured_minor') && (int) $attempt->getOriginal('captured_minor') !== 0) {
                throw new LogicException('Captured amount is immutable once recorded.');
            }
            if ($attempt->isDirty('refunded_minor') && (int) $attempt->refunded_minor < (int) $attempt->getOriginal('refunded_minor')) {
                throw new LogicException('Refunded amount can only grow.');
            }
            if ($attempt->isDirty('posting_status')) {
                $from = $attempt->getOriginal('posting_status');
                $to = $attempt->posting_status;
                if (! self::canTransitionPosting($from, $to)) {
                    throw new LogicException('Illegal payment attempt posting transition '.($from ?? 'null').' → '.($to ?? 'null').'.');
                }
                if ($attempt->capture_status !== self::STATUS_CAPTURED) {
                    throw new LogicException('Posting state requires a captured attempt.');
                }
            }
            if ($attempt->isDirty('accounting_date') && $attempt->getOriginal('accounting_date') !== null) {
                throw new LogicException('Accounting date is immutable once recorded.');
            }
            if ($attempt->isDirty('posted_at') && $attempt->getOriginal('posted_at') !== null) {
                throw new LogicException('Posted timestamp is immutable once recorded.');
            }
            if ($attempt->isDirty('capture_status')) {
                $from = (string) $attempt->getOriginal('capture_status');
                $to = (string) $attempt->capture_status;
                if (! self::canTransition($from, $to)) {
                    throw new LogicException("Illegal payment attempt transition {$from} → {$to}.");
                }
            }
        });

        static::deleting(fn () => throw new LogicException('Payment attempts are financial references and are never deleted.'));
    }

    public function isActive(): bool
    {
        return in_array($this->capture_status, self::ACTIVE_STATUSES, true);
    }

    public function requiresReview(): bool
    {
        return ! empty($this->review_reasons);
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(PaymentGateway::class, 'payment_gateway_id');
    }
}
