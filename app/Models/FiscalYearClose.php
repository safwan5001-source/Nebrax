<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * FISCAL-2 — **جيل إقفال**: محاولة إقفال واحدة مكتملة لسنة مالية.
 *
 * هذا الصفّ هو الهوية البنيوية لقيد الإقفال: القيد يحمل
 * `source_type = FiscalYearClose::class` و`source_id = $this->id`، فيُعرَف
 * القيد بعلاقةٍ لا بمطابقة نصّ وصفٍ أو كود حساب (FISCAL-1 يحظر ذلك صراحةً).
 *
 * `journal_entry_id === null` حالةٌ مشروعة: سنة بلا أي رصيد إيراد/مصروف
 * أُقفلت بلا قيد — ولا يُنشأ قيدٌ فارغ أو بصفر سطور لمجرّد التوثيق.
 */
class FiscalYearClose extends BaseModel implements CompanyWide
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_REVERSED = 'reversed';

    protected $fillable = [
        'tenant_id', 'fiscal_year_id', 'generation', 'status',
        'journal_entry_id', 'reversal_entry_id',
        'total_revenue', 'total_expense', 'net_income', 'retained_earnings_account_id',
        'closed_by', 'closed_at', 'reopened_by', 'reopened_at', 'reopen_reason',
    ];

    protected $casts = [
        'generation'    => 'integer',
        'total_revenue' => 'integer',
        'total_expense' => 'integer',
        'net_income'    => 'integer',
        'closed_at'     => 'datetime',
        'reopened_at'   => 'datetime',
    ];

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    /** أُقفلت السنة فعلاً بلا قيد لأن لا رصيد إيراد/مصروف يُقفل. */
    public function isZeroActivity(): bool
    {
        return $this->journal_entry_id === null;
    }

    public function fiscalYear(): BelongsTo
    {
        return $this->belongsTo(FiscalYear::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function reversalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'reversal_entry_id');
    }

    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function reopener(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reopened_by');
    }
}
