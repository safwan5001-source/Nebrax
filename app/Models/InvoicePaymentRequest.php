<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * طلب (رابط) دفع إلكتروني لفاتورة مرحَّلة (PAY-H2-02a، ADR-0006). **ليس أثراً مالياً**: لا سند ولا قيد؛ يمثّل الـPayable الذي تُنسَّق عليه
 * محاولات الدفع. CompanyWide + `branch_id` لقطة (كمحاولات الدفع) لأن الواجهة العامة تحلّه برمزه بلا سياق فرع.
 *
 * `allow_partial` (D-16) ممنوع افتراضياً وثابت بعد الإنشاء؛ هوية الطلب (فاتورة/طرف/بوابة/عملة) لا تتغيّر. الحالات رتيبة:
 * open ← cancelled | completed | expired (نهائية). طلب مفتوح واحد لكل فاتورة تفرضه القاعدة. لا حذف.
 */
class InvoicePaymentRequest extends BaseModel implements CompanyWide
{
    public const STATUS_OPEN = 'open';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_EXPIRED = 'expired';

    public const STATUSES = [self::STATUS_OPEN, self::STATUS_CANCELLED, self::STATUS_COMPLETED, self::STATUS_EXPIRED];

    /** مفتاح الـPayable: "<type>:<id>" (عقد `Payable::payableKey`). */
    public const PAYABLE_TYPE = 'invoice_payment_request';

    private const IMMUTABLE = [
        'tenant_id', 'branch_id', 'invoice_id', 'partner_id', 'payment_gateway_id', 'currency', 'allow_partial', 'created_by',
    ];

    protected $fillable = [
        'invoice_id', 'partner_id', 'payment_gateway_id', 'currency', 'allow_partial', 'token_hash', 'expires_at', 'created_by',
    ];

    protected $hidden = ['token_hash'];

    protected $attributes = [
        'status' => self::STATUS_OPEN,
        'allow_partial' => false,
    ];

    protected function casts(): array
    {
        return [
            'allow_partial' => 'boolean',
            'expires_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    public function payableKey(): string
    {
        return self::PAYABLE_TYPE.':'.$this->getKey();
    }

    public static function canTransition(string $from, string $to): bool
    {
        return $from === self::STATUS_OPEN && in_array($to, [self::STATUS_CANCELLED, self::STATUS_COMPLETED, self::STATUS_EXPIRED], true);
    }

    protected static function booted(): void
    {
        static::creating(function (self $request): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for invoice payment requests.');
            }
            $tenantId = (string) $context->id();
            if ($request->tenant_id !== null && (string) $request->tenant_id !== $tenantId) {
                throw new DomainException('Invoice payment request tenant cannot be forged.');
            }
            $request->tenant_id = $tenantId;

            // الفاتورة والبوابة تُحلّان بنطاق المستأجر: معرّف مستأجر آخر غير موجود هنا.
            if (! Invoice::query()->whereKey($request->invoice_id)->exists()) {
                throw new DomainException('Invoice payment request invoice must belong to the active tenant.');
            }
            if (! PaymentGateway::query()->whereKey($request->payment_gateway_id)->exists()) {
                throw new DomainException('Invoice payment request gateway must belong to the active tenant.');
            }
            $request->status = self::STATUS_OPEN;
            $request->branch_id ??= app(BranchContext::class)->id();
        });

        static::updating(function (self $request): void {
            foreach (self::IMMUTABLE as $field) {
                if ($request->isDirty($field)) {
                    throw new LogicException("Invoice payment request field [{$field}] is immutable.");
                }
            }
            if ($request->isDirty('token_hash') && $request->getOriginal('token_hash') !== null) {
                throw new LogicException('Invoice payment request token is immutable once set.');
            }
            if ($request->isDirty('status')) {
                $from = (string) $request->getOriginal('status');
                $to = (string) $request->status;
                if (! self::canTransition($from, $to)) {
                    throw new LogicException("Illegal invoice payment request transition {$from} → {$to}.");
                }
            }
        });

        static::deleting(fn () => throw new LogicException('Invoice payment requests are financial references and are never deleted.'));
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(PaymentGateway::class, 'payment_gateway_id');
    }
}
