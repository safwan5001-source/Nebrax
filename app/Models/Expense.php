<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Expense extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'account_id', 'partner_id', 'cost_center_id', 'expense_date',
        'payment_method', 'description', 'amount', 'tax_rate', 'tax_amount',
        'total', 'status', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'expense_date' => 'date',
        'amount'       => 'integer',
        'tax_rate'     => 'integer',
        'tax_amount'   => 'integer',
        'total'        => 'integer',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }
}
