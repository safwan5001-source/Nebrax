<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * تسوية عهدة موظف مرحّلة فور إنشائها:
 * مدين الحساب المختار │ دائن حساب العهدة، عبر EmployeeCustodyService وLedgerService.
 */
class EmployeeCustodySettlement extends BaseModel
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'tenant_id', 'branch_id', 'number', 'employee_custody_id', 'settlement_type_id',
        'debit_account_id', 'settlement_date', 'amount', 'notes', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'settlement_date' => 'date',
        'amount' => 'integer',
    ];

    public function custody(): BelongsTo
    {
        return $this->belongsTo(EmployeeCustody::class, 'employee_custody_id');
    }

    public function settlementType(): BelongsTo
    {
        return $this->belongsTo(SettlementType::class);
    }

    public function debitAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'debit_account_id');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
