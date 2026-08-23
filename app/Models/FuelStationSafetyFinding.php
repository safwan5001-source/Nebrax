<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** نتيجة checklist محفوظة مع فحص سلامة؛ الفشل قد يخلق إجراءً تصحيحياً صريحاً. */
class FuelStationSafetyFinding extends BaseModel
{
    use BranchScoped;

    public const RESULT_PASS = 'pass';
    public const RESULT_FAIL = 'fail';
    public const RESULT_NOT_APPLICABLE = 'not_applicable';
    public const RESULTS = [self::RESULT_PASS, self::RESULT_FAIL, self::RESULT_NOT_APPLICABLE];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_safety_inspection_id', 'checklist_key', 'result',
        'severity', 'title', 'details', 'asset_type', 'asset_id',
    ];

    public function inspection(): BelongsTo { return $this->belongsTo(FuelStationSafetyInspection::class, 'fuel_station_safety_inspection_id'); }
    public function asset(): MorphTo { return $this->morphTo(); }
    public function correctiveActions(): HasMany { return $this->hasMany(FuelStationSafetyCorrectiveAction::class); }
}
