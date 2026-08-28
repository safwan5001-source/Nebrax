<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجلّ نشاط append-only لقضية تحقيق — لا يُعدَّل ولا يُحذف (نفس نمط `PosExceptionReview`).
 * كل تغيير حالة/أولوية/تعيين/ربط دليل/ملاحظة/مرجع كاميرا/حسم يكتب صفّاً هنا فيبقى تاريخ
 * القرارات قابلاً للتدقيق بالكامل.
 */
class PosCaseActivity extends BaseModel
{
    use BranchScoped;

    public const ACTION_CREATED = 'created';
    public const ACTION_ASSIGNED = 'assigned';
    public const ACTION_REASSIGNED = 'reassigned';
    public const ACTION_STATUS_CHANGED = 'status_changed';
    public const ACTION_PRIORITY_CHANGED = 'priority_changed';
    public const ACTION_EVIDENCE_LINKED = 'evidence_linked';
    public const ACTION_EVIDENCE_UNLINKED = 'evidence_unlinked';
    public const ACTION_NOTE_ADDED = 'note_added';
    public const ACTION_CCTV_BOOKMARK_ADDED = 'cctv_bookmark_added';
    public const ACTION_CCTV_BOOKMARK_UPDATED = 'cctv_bookmark_updated';
    public const ACTION_CCTV_BOOKMARK_REMOVED = 'cctv_bookmark_removed';
    public const ACTION_RESOLUTION_RECORDED = 'resolution_recorded';
    public const ACTION_REOPENED = 'reopened';
    public const ACTION_OUTCOME_UPDATED = 'outcome_updated';
    public const ACTION_AMOUNT_OUTCOME_UPDATED = 'amount_outcome_updated';

    public $timestamps = false;

    protected $fillable = [
        'branch_id', 'case_id', 'action', 'actor_id', 'meta', 'note', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('نشاط القضية لا يُعدّل بعد إنشائه.'));
        static::deleting(static fn () => throw new LogicException('نشاط القضية لا يُحذف.'));
    }

    public function investigationCase(): BelongsTo
    {
        return $this->belongsTo(PosInvestigationCase::class, 'case_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
