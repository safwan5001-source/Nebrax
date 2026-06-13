<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class JournalLine extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'journal_entry_id', 'account_id',
        'debit', 'credit', 'description', 'partner_type', 'partner_id',
    ];

    protected $casts = [
        'debit'  => 'integer',
        'credit' => 'integer',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function entry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }
}
