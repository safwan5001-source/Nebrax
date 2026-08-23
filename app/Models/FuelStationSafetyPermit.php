<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use LogicException;

/** تصريح أو شهادة امتثال؛ المرجع قد يشير إلى ملف في التخزين وفق سياسة المرفقات القائمة. */
class FuelStationSafetyPermit extends BaseModel
{
    use BranchScoped;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_REVOKED = 'revoked';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_EXPIRED, self::STATUS_REVOKED];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'permit_type', 'reference', 'status',
        'issued_on', 'expires_on', 'asset_type', 'asset_id', 'evidence_reference', 'created_by',
    ];

    protected $casts = ['issued_on' => 'date', 'expires_on' => 'date'];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('لا يحذف التصريح أو الشهادة حفاظاً على تاريخ الامتثال.'));
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function asset(): MorphTo { return $this->morphTo(); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
