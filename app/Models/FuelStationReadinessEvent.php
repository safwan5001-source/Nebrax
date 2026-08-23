<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use LogicException;

/** سجل تدقيق append-only لتغييرات الصيانة والسلامة والتنبيه في Cycle 9. */
class FuelStationReadinessEvent extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'subject_type', 'subject_id', 'event_type',
        'before', 'after', 'reason', 'performed_by', 'occurred_at',
    ];

    protected $casts = ['before' => 'array', 'after' => 'array', 'occurred_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('أحداث جاهزية محطة الوقود غير قابلة للتعديل.'));
        static::deleting(fn () => throw new LogicException('أحداث جاهزية محطة الوقود غير قابلة للحذف.'));
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function subject(): MorphTo { return $this->morphTo(); }
    public function actor(): BelongsTo { return $this->belongsTo(User::class, 'performed_by'); }
}
