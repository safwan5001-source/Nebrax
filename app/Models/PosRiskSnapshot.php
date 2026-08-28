<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * لقطة درجة مراجعة مشتقّة لكل موضوع (مستخدم) ضمن فرع. مشتقّة بالكامل من
 * الاستثناءات وتُحدَّث (upsert) عند كل كشف فتبقى القراءة idempotent. الدرجة
 * مفسَّرة لا صندوق أسود: `components` يخزّن مساهمة كل فئة وسائقيها وأساس المقارنة.
 *
 * **الدرجة ترتّب أولوية المراجعة، وليست دليلاً على مخالفة.**
 */
class PosRiskSnapshot extends BaseModel
{
    use BranchScoped;

    public const BAND_NORMAL = 'normal';
    public const BAND_WATCH = 'watch';
    public const BAND_REVIEW = 'review';
    public const BAND_PRIORITY = 'priority';

    protected $fillable = [
        'branch_id', 'scope', 'subject_user_id', 'window_start', 'window_end',
        'total_score', 'band', 'exception_count', 'amount_under_review',
        'sample_size', 'sample_sufficient', 'components', 'calculated_at',
    ];

    protected function casts(): array
    {
        return [
            'components' => 'array',
            'window_start' => 'datetime',
            'window_end' => 'datetime',
            'calculated_at' => 'datetime',
            'total_score' => 'integer',
            'exception_count' => 'integer',
            'amount_under_review' => 'integer',
            'sample_size' => 'integer',
            'sample_sufficient' => 'boolean',
        ];
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_user_id');
    }
}
