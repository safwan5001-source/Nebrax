<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * استثناء رقابي مشتقّ — «نشاط يحتاج مراجعة»، وليس دليل مخالفة. بيانات تشغيلية
 * معزولة بالفرع (BranchScoped)، مشتقّة بالكامل من `PosSessionEvent` الثابت الذي
 * تشير إليه عبر `evidence_event_ids`. لا يولّد قيداً ولا يعدّل رصيداً.
 *
 * صف واحد لكل (قاعدة/موضوع/نافذة) بمفتاح `dedup_key` فريد، فإعادة الكشف تحدّثه
 * ولا تكرّره (idempotent).
 */
class PosException extends BaseModel
{
    use BranchScoped;

    // النطاقات الدلالية للشدّة/الدرجة — محايدة اللغة عمداً.
    public const SEVERITY_WATCH = 'watch';
    public const SEVERITY_REVIEW = 'review';
    public const SEVERITY_PRIORITY = 'priority';

    // دورة المراجعة الخفيفة (ليست إدارة قضايا كاملة).
    public const STATE_NEW = 'new';
    public const STATE_REVIEWING = 'reviewing';
    public const STATE_EXPLAINED = 'explained';
    public const STATE_DISMISSED = 'dismissed';
    public const STATE_NEEDS_INVESTIGATION = 'needs_investigation';

    public const STATES = [
        self::STATE_NEW, self::STATE_REVIEWING, self::STATE_EXPLAINED,
        self::STATE_DISMISSED, self::STATE_NEEDS_INVESTIGATION,
    ];

    protected $fillable = [
        'branch_id', 'rule_key', 'category', 'rule_version', 'rule_snapshot',
        'subject_user_id', 'pos_session_id', 'cart_id', 'performed_by', 'approved_by',
        'window_start', 'window_end', 'observed_count', 'denominator', 'observed_rate_milli',
        'baseline_rate_milli', 'baseline_type', 'sample_size', 'severity', 'risk_contribution',
        'amount_under_review', 'evidence_confidence', 'dedup_key', 'evidence_event_ids',
        'amount_event_ids', 'explanation', 'detected_at', 'review_state', 'reviewed_by',
        'reviewed_at', 'review_reason', 'review_note',
    ];

    protected function casts(): array
    {
        return [
            'rule_snapshot' => 'array',
            'evidence_event_ids' => 'array',
            'amount_event_ids' => 'array',
            'explanation' => 'array',
            'window_start' => 'datetime',
            'window_end' => 'datetime',
            'detected_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'observed_count' => 'integer',
            'denominator' => 'integer',
            'observed_rate_milli' => 'integer',
            'baseline_rate_milli' => 'integer',
            'sample_size' => 'integer',
            'risk_contribution' => 'integer',
            'amount_under_review' => 'integer',
        ];
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_user_id');
    }

    public function performedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'performed_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(PosExceptionReview::class)->orderBy('created_at');
    }
}
