<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * مستند مصدر لقيد يومية يدوي.
 *
 * يحفظ المستخدم المسودة هنا؛ أما القيد المرحّل فينشئه LedgerService حصراً
 * ويرتبط بهذه الوثيقة عبر source_type/source_id و journal_entry_id.
 */
class ManualJournal extends BaseModel
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'number',
        'entry_date',
        'description',
        'status',
        'journal_entry_id',
        'created_by',
    ];

    protected $casts = [
        'entry_date' => 'date',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(ManualJournalLine::class)->orderBy('sort_order');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }

    /** مرجع منشئ محفوظ؛ لا يختفي بتبدّل سياق الفرع. */
    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    public function isReversed(): bool
    {
        return $this->status === 'reversed';
    }
}
