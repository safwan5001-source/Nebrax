<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * رابط دليل لقضية تحقيق — يشير إلى استثناء/حدث Phase 1/2 بمعرّفه فقط، لا ينسخ قيمته ولا
 * يعدّله. الفكّ منطقي (`unlinked_at`) لا حذف صلب، فيبقى تاريخ الربط قابلاً للتدقيق.
 */
class PosCaseEvidenceLink extends BaseModel
{
    use BranchScoped;

    public const TYPE_EXCEPTION = 'exception';
    public const TYPE_EVENT = 'event';
    public const TYPE_MANUAL = 'manual';

    protected $fillable = [
        'branch_id', 'case_id', 'pos_exception_id', 'pos_session_event_id',
        'cart_id', 'correlation_id', 'link_type', 'rationale',
        'linked_by', 'linked_at', 'unlinked_by', 'unlinked_at',
    ];

    protected function casts(): array
    {
        return [
            'linked_at' => 'datetime',
            'unlinked_at' => 'datetime',
        ];
    }

    public function investigationCase(): BelongsTo
    {
        return $this->belongsTo(PosInvestigationCase::class, 'case_id');
    }

    public function exception(): BelongsTo
    {
        return $this->belongsTo(PosException::class, 'pos_exception_id');
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(PosSessionEvent::class, 'pos_session_event_id');
    }

    public function linkedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'linked_by');
    }
}
