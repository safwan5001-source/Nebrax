<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** قراءة دليل مادي أو ATG؛ لا تنشئ حركة مخزون ولا تسوية بحد ذاتها. */
class FuelTankReading extends BaseModel
{
    use BranchScoped;

    public const TYPE_PHYSICAL = 'physical';
    public const TYPE_ATG = 'atg';
    public const TYPES = [self::TYPE_PHYSICAL, self::TYPE_ATG];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_tank_id', 'reading_type',
        'quantity_milliliters', 'measured_at', 'evidence_key', 'evidence', 'recorded_by',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer',
        'measured_at' => 'datetime',
        'evidence' => 'array',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Fuel tank readings are immutable evidence.'));
        static::deleting(fn () => throw new LogicException('Fuel tank readings cannot be deleted.'));
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function recorder(): BelongsTo { return $this->belongsTo(User::class, 'recorded_by'); }
}
