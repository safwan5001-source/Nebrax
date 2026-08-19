<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** تحويل مرحّل وفوري بين خزائن وحسابات بنكية من العملة نفسها. */
class CashBankTransfer extends BaseModel
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'tenant_id', 'branch_id', 'number', 'source_cash_bank_account_id',
        'destination_cash_bank_account_id', 'amount', 'currency', 'transfer_date',
        'reference', 'notes', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'amount' => 'integer',
        'transfer_date' => 'date',
    ];

    public function source(): BelongsTo
    {
        return $this->belongsTo(CashBankAccount::class, 'source_cash_bank_account_id');
    }

    public function destination(): BelongsTo
    {
        return $this->belongsTo(CashBankAccount::class, 'destination_cash_bank_account_id');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
