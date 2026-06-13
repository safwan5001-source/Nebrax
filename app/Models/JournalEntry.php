<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class JournalEntry extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'entry_date', 'description',
        'status', 'source_type', 'source_id', 'reversal_of', 'created_by', 'posted_at',
    ];

    protected $casts = [
        'entry_date' => 'date',
        'posted_at'  => 'datetime',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class);
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }
}
