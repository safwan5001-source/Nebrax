<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

/**
 * لقطة مجمَّدة لمطابقة فوهة عند إغلاق الوردية (TANKER-PR8): M = D + T + U. تشغيلية فقط — لا أثر مالي أو مخزني.
 * الكاتب الوحيد `FuelShiftMeterReconciliationService` (لا `$fillable`)؛ الثبات في القاعدة أيضاً.
 */
class FuelShiftNozzleReconciliation extends BaseModel
{
    use BranchScoped;

    public const STATUS_BALANCED = 'balanced';
    public const STATUS_WITHIN_TOLERANCE = 'within_tolerance';
    public const STATUS_VARIANCE = 'variance';
    public const STATUS_INCOMPLETE = 'incomplete';
    public const STATUSES = [self::STATUS_BALANCED, self::STATUS_WITHIN_TOLERANCE, self::STATUS_VARIANCE, self::STATUS_INCOMPLETE];

    public const INCOMPLETE_MISSING_READING = 'missing_reading';
    public const INCOMPLETE_CLOSING_BELOW_OPENING = 'closing_below_opening';

    protected $casts = [
        'metered_milliliters' => 'integer', 'direct_sale_milliliters' => 'integer', 'tanker_fill_milliliters' => 'integer', 'tanker_fill_count' => 'integer',
        'draft_sale_milliliters' => 'integer', 'unexplained_milliliters' => 'integer', 'tolerance_milliliters' => 'integer', 'frozen_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('لقطة مطابقة الفوهة مجمَّدة ولا تُعدَّل.'));
        static::deleting(fn () => throw new LogicException('لقطة مطابقة الفوهة لا تُحذف.'));
    }

    /** هل يحتاج الفرق مراجعة مشرف؟ (فرق خارج التفاوت أو مطابقة لم تكتمل). */
    public function requiresReview(): bool
    {
        return in_array($this->status, [self::STATUS_VARIANCE, self::STATUS_INCOMPLETE], true);
    }

    public function nozzle(): BelongsTo { return $this->belongsTo(FuelNozzle::class, 'fuel_nozzle_id'); }
    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function review(): HasOne { return $this->hasOne(FuelShiftMeterVarianceReview::class, 'fuel_shift_nozzle_reconciliation_id'); }
}
