<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر قيد — موسوم بالفرع، وتصفيته صريحة في التقارير حصراً */
class JournalLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'journal_entry_id', 'account_id',
        'debit', 'credit', 'description', 'partner_type', 'partner_id', 'cost_center_id',
        'branch_id',
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

    /** مرجع مخزَّن في سطر قيد مرحَّل — لا يُصفّى بالفرع أبداً. */
    public function costCenter(): BelongsTo
    {
        return $this->referenceBelongsTo(CostCenter::class);
    }
}
