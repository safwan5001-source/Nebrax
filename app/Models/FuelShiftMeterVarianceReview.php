<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * مراجعة مشرف لفرق عدّاد فوهة (TANKER-PR8، `fuel.shift.meter_variance_review`): **تصنيف وصفي فقط** — لا قيد ولا مخزون ولا فاتورة ولا تصحيح قراءة. قرار واحد لكل لقطة، ثابت.
 */
class FuelShiftMeterVarianceReview extends BaseModel
{
    use BranchScoped;

    public const UNRECORDED_DIRECT_SALE = 'unrecorded_direct_sale';
    public const UNRECORDED_TANKER_FILL = 'unrecorded_tanker_fill';
    public const OVER_RECORDED_ENTRY = 'over_recorded_entry';
    public const READING_ERROR = 'reading_error';
    public const CALIBRATION_TEST = 'calibration_test';
    public const INTERNAL_USE = 'internal_use';
    public const LOSS_OR_LEAK = 'loss_or_leak';
    public const OTHER = 'other';

    /** التصنيفات المسموحة لكل نوع فرق (قائمة ثابتة وصفية؛ معالجتها المحاسبية قرار مالك D-8-3 ولا أثر لها هنا). */
    public const FOR_SURPLUS = [self::UNRECORDED_DIRECT_SALE, self::UNRECORDED_TANKER_FILL, self::READING_ERROR, self::CALIBRATION_TEST, self::INTERNAL_USE, self::LOSS_OR_LEAK, self::OTHER];
    public const FOR_OVER_RECORDED = [self::OVER_RECORDED_ENTRY, self::READING_ERROR, self::OTHER];
    public const FOR_INCOMPLETE = [self::READING_ERROR, self::OTHER];
    public const ALL = [self::UNRECORDED_DIRECT_SALE, self::UNRECORDED_TANKER_FILL, self::OVER_RECORDED_ENTRY, self::READING_ERROR, self::CALIBRATION_TEST, self::INTERNAL_USE, self::LOSS_OR_LEAK, self::OTHER];

    protected $casts = ['reviewed_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('مراجعة فرق العدّاد قرار ثابت ولا تُعدَّل.'));
        static::deleting(fn () => throw new LogicException('مراجعة فرق العدّاد لا تُحذف.'));
    }

    public function reconciliation(): BelongsTo { return $this->belongsTo(FuelShiftNozzleReconciliation::class, 'fuel_shift_nozzle_reconciliation_id'); }
    public function reviewer(): BelongsTo { return $this->belongsTo(User::class, 'reviewed_by'); }
}
