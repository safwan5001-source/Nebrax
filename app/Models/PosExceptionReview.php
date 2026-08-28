<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجلّ إجراء مراجعة append-only على استثناء رقابي. لا يُعدَّل ولا يُحذف: تاريخ
 * قرارات المراجعة يجب أن يبقى قابلاً للتدقيق ولا يُطمس فوق قرار سابق. لا يمسّ
 * الدليل الأصلي (`PosSessionEvent`) إطلاقاً.
 */
class PosExceptionReview extends BaseModel
{
    use BranchScoped;

    public $timestamps = false;

    protected $fillable = [
        'branch_id', 'pos_exception_id', 'from_state', 'to_state',
        'reviewed_by', 'reason', 'note', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('سجلّ مراجعة الاستثناء لا يُعدّل بعد إنشائه.'));
        static::deleting(static fn () => throw new LogicException('سجلّ مراجعة الاستثناء لا يُحذف.'));
    }

    public function exception(): BelongsTo
    {
        return $this->belongsTo(PosException::class, 'pos_exception_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
