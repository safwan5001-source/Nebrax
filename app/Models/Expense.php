<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Expense extends BaseModel
{
    use ResolvesBranchReferences;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'account_id', 'category_id', 'partner_id', 'vendor_name',
        'cost_center_id', 'expense_date', 'payment_method', 'description', 'amount',
        'tax_rate', 'tax_amount', 'total', 'status', 'journal_entry_id', 'created_by',
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

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function category(): BelongsTo
    {
        return $this->referenceBelongsTo(ExpenseCategory::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(ExpenseAttachment::class);
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
