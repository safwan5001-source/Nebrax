<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** @see design-system/foundations/multi-branch-architecture.md — مشترك: قيد محاسبي — التصفية بالفرع صريحة في التقارير (لا Scope عالمي) حمايةً لميزان المراجعة المجمّع */
class JournalEntry extends BaseModel implements CompanyWide
{
    use GeneratesDocumentNumbers;

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
