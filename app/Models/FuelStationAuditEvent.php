<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * FS-22: حدث تدقيق بالفاعل لتغيير البيانات الرئيسية/الأجهزة (append-only: النموذج هنا والمشغّلات في القاعدة).
 * تشغيلي معزول بالفرع كأحداث الجاهزية؛ `branch_id` null للأحداث غير المنسوبة لفرع.
 */
class FuelStationAuditEvent extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'actor_id', 'action', 'subject_type', 'subject_id',
        'before', 'after', 'reason', 'occurred_at',
    ];

    protected $casts = ['before' => 'array', 'after' => 'array', 'occurred_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حدث تدقيق محطة الوقود غير قابل للتعديل.'));
        static::deleting(fn () => throw new LogicException('حدث تدقيق محطة الوقود غير قابل للحذف.'));
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }
}
