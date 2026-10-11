<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * قرار مراجعة المالية لسطر إشعار دائن مرحَّل قديم لا يُنسب إلى سطر فاتورة بلا تخمين
 * (AWJ-TAX-REM-02). طبقة تراكب: لا تُعدَّل بها المستندات المرحَّلة.
 *
 * للإلحاق فقط: التعديل والحذف مرفوضان من التطبيق، فالقرار أثرٌ تدقيقي. التصحيح
 * (قرارٌ خاطئ) يمرّ بإجراء تشغيلي موثَّق لا بتعديل صامت.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: قرار مالي على مستوى المؤسسة، لا يخصّ فرعاً */
class CreditNoteLegacyReview extends BaseModel implements CompanyWide
{
    public const ATTRIBUTED = 'attributed';
    public const NOT_APPLICABLE = 'not_applicable';

    protected $fillable = [
        'tenant_id', 'credit_note_line_id', 'outcome', 'source_line_id', 'reason', 'reviewed_by', 'reviewed_at',
    ];

    protected $casts = ['reviewed_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new RuntimeException('قرار مراجعة الإشعار التاريخي للإلحاق فقط.'));
        static::deleting(fn () => throw new RuntimeException('قرار مراجعة الإشعار التاريخي للإلحاق فقط.'));
    }

    public function line(): BelongsTo
    {
        return $this->belongsTo(CreditNoteLine::class, 'credit_note_line_id');
    }
}
