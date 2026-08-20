<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر تابع لمسودة قيد يدوي. يتبع فرع الرأس ولا يعزل مستقلاً.
 * جميع المبالغ بالهللات؛ يتحقق LedgerService من التوازن عند الترحيل.
 */
class ManualJournalLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id',
        'manual_journal_id',
        'account_id',
        'description',
        'debit',
        'credit',
        'partner_type',
        'partner_id',
        'cost_center_id',
        'sort_order',
    ];

    protected $casts = [
        'debit'      => 'integer',
        'credit'     => 'integer',
        'sort_order' => 'integer',
    ];

    public function manualJournal(): BelongsTo
    {
        return $this->belongsTo(ManualJournal::class);
    }

    /** مرجع الحساب في المستند قائم حتى إن تغيّر الفرع النشط عند العرض أو التقرير. */
    public function account(): BelongsTo
    {
        return $this->referenceBelongsTo(Account::class);
    }

    /** مرجع بُعد تحليلي محفوظ؛ لا يُصفّى بعد إنشاء المستند. */
    public function costCenter(): BelongsTo
    {
        return $this->referenceBelongsTo(CostCenter::class);
    }
}
