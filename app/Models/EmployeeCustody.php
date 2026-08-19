<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * عهدة موظف: مسودة ثم ترحيل صرف واحد عبر EmployeeCustodyService.
 *
 * عند الترحيل فقط:
 *   مدين 1160 عُهَد الموظفين
 *   دائن الخزينة أو الحساب البنكي المختار
 *
 * لا تسويات في الإصدار الأول؛ يبقى الرصيد مفتوحاً حتى تنفيذ أنواع التسوية.
 */
class EmployeeCustody extends BaseModel
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'number', 'employee_id', 'custody_account_id',
        'cash_account_id', 'method', 'custody_date', 'due_date', 'amount', 'status',
        'notes', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'custody_date' => 'date',
        'due_date' => 'date',
        'amount' => 'integer',
    ];

    protected $attributes = [
        'method' => 'cash',
        'status' => 'draft',
        'amount' => 0,
    ];

    /** الموظف مرجع محاسبي مخزّن؛ يحل خارج أي تصفية فرعية. */
    public function employee(): BelongsTo
    {
        return $this->referenceBelongsTo(Employee::class);
    }

    public function custodyAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'custody_account_id');
    }

    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'cash_account_id');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }
}
