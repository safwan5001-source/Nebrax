<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** مركبة أسطول مستقلة؛ قد تخص عميلاً تعاقدياً أو أسطول Nebrax الداخلي مستقبلاً. */
class FuelFleetVehicle extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_SUSPENDED, self::STATUS_INACTIVE];

    protected $fillable = [
        'tenant_id', 'partner_id', 'corporate_fuel_contract_id', 'plate_number', 'plate_country',
        'vin', 'fleet_number', 'fuel_type', 'tank_capacity_milliliters', 'odometer', 'status', 'created_by',
    ];

    protected $casts = [
        'tank_capacity_milliliters' => 'integer',
        'odometer' => 'integer',
    ];

    protected $attributes = ['status' => self::STATUS_ACTIVE];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('مركبة الأسطول لا تحذف؛ عطّلها للحفاظ على تاريخ التفويض والاستخدام.'));
    }

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }

    public function allowedFuelProducts(): HasMany
    {
        return $this->hasMany(FuelFleetVehicleProduct::class);
    }

    public function odometerReadings(): HasMany
    {
        return $this->hasMany(FuelVehicleOdometerReading::class)->orderByDesc('recorded_at');
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }
}
