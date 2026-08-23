<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** قراءة عداد فوهة عند فتح/إغلاق الشفت؛ ليست FuelSale ولا حركة مخزون أو إيراد. */
class FuelShiftMeterReading extends BaseModel
{
    use BranchScoped;

    public const STAGE_OPENING = 'opening';
    public const STAGE_CLOSING = 'closing';
    public const STAGES = [self::STAGE_OPENING, self::STAGE_CLOSING];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_shift_id', 'fuel_nozzle_id', 'reading_stage', 'meter_milliliters',
        'evidence_key', 'evidence', 'recorded_by', 'measured_at',
    ];

    protected $casts = [
        'meter_milliliters' => 'integer',
        'evidence' => 'array',
        'measured_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('قراءة عداد الشفت دليل تشغيلي لا يعدّل مباشرة.'));
        static::deleting(fn () => throw new LogicException('قراءة عداد الشفت لا تحذف مباشرة.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function nozzle(): BelongsTo { return $this->belongsTo(FuelNozzle::class, 'fuel_nozzle_id'); }
    public function recorder(): BelongsTo { return $this->belongsTo(User::class, 'recorded_by'); }
}
