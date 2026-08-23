<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سعر لتر الوقود المؤرخ. صف بلا محطة هو tenant default؛ صف بمحطة هو override.
 * لا يعدّل السعر التاريخي ولا يحذف: أي تغيير ينشئ فترة سعر جديدة مع حدث تدقيق.
 */
class FuelStationProductPrice extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_INACTIVE];

    protected $fillable = [
        'tenant_id', 'fuel_station_id', 'fuel_product_id', 'price_per_liter_minor',
        'effective_from', 'effective_until', 'status', 'created_by', 'approved_by', 'reason',
    ];

    protected $casts = [
        'price_per_liter_minor' => 'integer',
        'effective_from' => 'datetime',
        'effective_until' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('سعر الوقود المؤرخ لا يعدّل؛ أنشئ سعراً جديداً بفترة فعالية جديدة.'));
        static::deleting(fn () => throw new LogicException('سعر الوقود المؤرخ لا يحذف؛ يبقى دليلاً على التسعير التاريخي.'));
    }

    public function station(): BelongsTo { return $this->referenceBelongsTo(FuelStation::class, 'fuel_station_id'); }
    public function fuelProduct(): BelongsTo { return $this->referenceBelongsTo(FuelProduct::class); }
    public function creator(): BelongsTo { return $this->referenceBelongsTo(User::class, 'created_by'); }
    public function approver(): BelongsTo { return $this->referenceBelongsTo(User::class, 'approved_by'); }
}
