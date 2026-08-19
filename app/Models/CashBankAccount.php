<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * تعريف خزينة أو حساب بنكي مرتبط بحساب أستاذ واحد. الرصيد مصدره AccountBalance.
 * @see design-system/foundations/multi-branch-architecture.md — إعداد مالي مشترك للمؤسسة.
 */
class CashBankAccount extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'account_id', 'type', 'name', 'bank_name', 'account_number', 'currency',
        'description', 'is_active', 'is_main', 'deposit_scope', 'deposit_scope_subject',
        'withdraw_scope', 'withdraw_scope_subject', 'created_by',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'is_main' => 'boolean',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function outgoingTransfers(): HasMany
    {
        return $this->hasMany(CashBankTransfer::class, 'source_cash_bank_account_id');
    }

    public function incomingTransfers(): HasMany
    {
        return $this->hasMany(CashBankTransfer::class, 'destination_cash_bank_account_id');
    }

    /** يتحقق من نطاق إيداع أو سحب المستخدم في الكيان. */
    public function allows(string $action, ?User $user, ?string $branchId): bool
    {
        $scope = $action === 'deposit' ? $this->deposit_scope : $this->withdraw_scope;
        $subject = $action === 'deposit' ? $this->deposit_scope_subject : $this->withdraw_scope_subject;

        return match ($scope) {
            'all' => true,
            'role' => $user !== null && $user->role === $subject,
            'user' => $user !== null && $user->id === $subject,
            'branch' => $branchId !== null && $branchId === $subject,
            default => false,
        };
    }
}
