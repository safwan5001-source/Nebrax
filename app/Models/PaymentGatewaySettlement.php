<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PaymentGatewaySettlement extends BaseModel implements CompanyWide
{
    public const STATUS_POSTED = 'posted';

    protected $fillable = [
        'tenant_id',
        'payment_gateway_id',
        'cash_bank_account_id',
        'provider_settlement_ref',
        'settlement_date',
        'status',
        'gross_amount',
        'net_bank_amount',
        'provider_fee_ex_tax',
        'provider_fee_tax',
        'provider_deductions',
        'provider_credits',
        'currency',
        'gateway_provider',
        'gateway_name',
        'clearing_account_id',
        'fee_expense_account_id',
        'bank_account_id',
        'journal_entry_id',
        'posted_at',
        'created_by',
    ];

    protected $casts = [
        'settlement_date' => 'date',
        'posted_at' => 'datetime',
        'gross_amount' => 'integer',
        'net_bank_amount' => 'integer',
        'provider_fee_ex_tax' => 'integer',
        'provider_fee_tax' => 'integer',
        'provider_deductions' => 'integer',
        'provider_credits' => 'integer',
    ];

    protected $attributes = [
        'status' => self::STATUS_POSTED,
        'currency' => 'SAR',
        'provider_fee_ex_tax' => 0,
        'provider_fee_tax' => 0,
        'provider_deductions' => 0,
        'provider_credits' => 0,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $settlement): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for gateway settlements.');
            }

            $tenantId = (string) $context->id();
            if ($settlement->tenant_id !== null && (string) $settlement->tenant_id !== $tenantId) {
                throw new DomainException('Gateway settlement tenant cannot be forged.');
            }

            $settlement->tenant_id = $tenantId;

            if ($settlement->exists && $settlement->getOriginal('status') === self::STATUS_POSTED) {
                $watched = [
                    'gross_amount', 'net_bank_amount', 'provider_fee_ex_tax', 'provider_fee_tax',
                    'provider_deductions', 'provider_credits',
                    'payment_gateway_id', 'cash_bank_account_id', 'provider_settlement_ref',
                    'settlement_date', 'clearing_account_id', 'fee_expense_account_id', 'bank_account_id',
                ];
                foreach ($watched as $field) {
                    if ($settlement->isDirty($field)) {
                        throw new DomainException('Posted gateway settlements are immutable.');
                    }
                }

                if ($settlement->isDirty('journal_entry_id') && $settlement->getOriginal('journal_entry_id') !== null) {
                    throw new DomainException('Posted gateway settlements are immutable.');
                }
            }
        });
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(PaymentGateway::class, 'payment_gateway_id');
    }

    public function cashBankAccount(): BelongsTo
    {
        return $this->belongsTo(CashBankAccount::class, 'cash_bank_account_id');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(PaymentGatewaySettlementItem::class, 'settlement_id');
    }

    public function isPosted(): bool
    {
        return $this->status === self::STATUS_POSTED;
    }
}
