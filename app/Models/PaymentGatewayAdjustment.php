<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * تعديل مزوّد غير العمولة (PAY-H3-02c، ADR-0008 D-22): احتجاز/إفراج احتياطي أو تعديل مدين/دائن بدليل وسبب وموافقة مستقلة.
 * الحالات: requested → approved | rejected | cancelled؛ approved → consumed (بتسوية مرحَّلة) | cancelled. المعتمِد ≠ الطالب (الخدمة والقاعدة).
 * لا يكتب قيداً بنفسه: أثره المحاسبي يتولّد مع التسوية التي تستهلكه عبر `LedgerService`. `CompanyWide` كترويسة التسوية.
 */
class PaymentGatewayAdjustment extends BaseModel implements CompanyWide
{
    public const KIND_RESERVE_HOLD = 'reserve_hold';

    public const KIND_RESERVE_RELEASE = 'reserve_release';

    public const KIND_DEBIT = 'adjustment_debit';

    public const KIND_CREDIT = 'adjustment_credit';

    public const KINDS = [self::KIND_RESERVE_HOLD, self::KIND_RESERVE_RELEASE, self::KIND_DEBIT, self::KIND_CREDIT];

    /** أثر النوع على صافي البنك: سالب = يخصمه المزوّد من الصرف، موجب = يضيفه. */
    public const BANK_SIGN = [self::KIND_RESERVE_HOLD => -1, self::KIND_RESERVE_RELEASE => 1, self::KIND_DEBIT => -1, self::KIND_CREDIT => 1];

    public const REQUESTED = 'requested';

    public const APPROVED = 'approved';

    public const REJECTED = 'rejected';

    public const CANCELLED = 'cancelled';

    public const CONSUMED = 'consumed';

    public const STATUSES = [self::REQUESTED, self::APPROVED, self::REJECTED, self::CANCELLED, self::CONSUMED];

    protected $fillable = [
        'tenant_id', 'payment_gateway_id', 'kind', 'amount_minor', 'currency', 'reason', 'evidence_ref', 'provider_event_ref', 'status',
        'requested_by', 'requested_at', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason',
        'cancelled_by', 'cancelled_at', 'cancel_reason', 'settlement_id',
    ];

    protected $attributes = ['status' => self::REQUESTED];

    protected function casts(): array
    {
        return [
            'amount_minor' => 'integer',
            'requested_at' => 'datetime', 'approved_at' => 'datetime', 'rejected_at' => 'datetime', 'cancelled_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (self $adjustment): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for gateway adjustments.');
            }
            $tenantId = (string) $context->id();
            if ($adjustment->tenant_id !== null && (string) $adjustment->tenant_id !== $tenantId) {
                throw new DomainException('Gateway adjustment tenant cannot be forged.');
            }
            $adjustment->tenant_id = $tenantId;
            if (! $adjustment->exists && ! PaymentGateway::query()->whereKey($adjustment->payment_gateway_id)->exists()) {
                throw new DomainException('Adjustment gateway must belong to the active tenant.');
            }
        });
        static::deleting(fn () => throw new DomainException('Gateway adjustments cannot be deleted.'));
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(PaymentGateway::class, 'payment_gateway_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(PaymentGatewayAdjustmentEvent::class, 'adjustment_id');
    }

    public function bankEffect(): int
    {
        return self::BANK_SIGN[$this->kind] * (int) $this->amount_minor;
    }
}
