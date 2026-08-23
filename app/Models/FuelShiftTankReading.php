<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** قراءة خزان مرتبطة بالشفت؛ دليل Physical/ATG تشغيلي لا يحدّث Book Stock. */
class FuelShiftTankReading extends BaseModel
{
    use BranchScoped;

    public const STAGE_OPENING = 'opening';
    public const STAGE_CLOSING = 'closing';
    public const STAGES = [self::STAGE_OPENING, self::STAGE_CLOSING];

    public const TYPE_PHYSICAL = 'physical';
    public const TYPE_ATG = 'atg';
    public const TYPES = [self::TYPE_PHYSICAL, self::TYPE_ATG];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_shift_id', 'fuel_tank_id', 'reading_stage', 'reading_type',
        'quantity_milliliters', 'evidence_key', 'evidence', 'recorded_by', 'measured_at',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer',
        'evidence' => 'array',
        'measured_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('قراءة خزان الشفت دليل تشغيلي لا يعدّل مباشرة.'));
        static::deleting(fn () => throw new LogicException('قراءة خزان الشفت لا تحذف مباشرة.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function recorder(): BelongsTo { return $this->belongsTo(User::class, 'recorded_by'); }
}
