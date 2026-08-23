<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** بطاقة وقود منطقية لتفويض التحميل على عقد العميل؛ ليست Payment ولا RFID/AVI. */
class FuelCard extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUS_LOST = 'lost';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_REPLACED = 'replaced';
    public const STATUSES = [
        self::STATUS_ACTIVE,
        self::STATUS_SUSPENDED,
        self::STATUS_LOST,
        self::STATUS_EXPIRED,
        self::STATUS_CANCELLED,
        self::STATUS_REPLACED,
    ];

    public const RESTRICTION_ALL = 'all';
    public const RESTRICTION_SELECTED = 'selected';
    public const RESTRICTION_MODES = [self::RESTRICTION_ALL, self::RESTRICTION_SELECTED];

    protected $fillable = [
        'tenant_id', 'public_identifier', 'credential_hash', 'partner_id', 'corporate_fuel_contract_id',
        'fuel_fleet_vehicle_id', 'fuel_fleet_driver_id', 'status', 'effective_from', 'effective_until',
        'per_transaction_milliliters', 'per_transaction_value_minor', 'daily_milliliters', 'daily_value_minor',
        'weekly_milliliters', 'weekly_value_minor', 'monthly_milliliters', 'monthly_value_minor',
        'daily_transaction_count', 'station_restriction_mode', 'fuel_restriction_mode', 'allowed_time_windows',
        'replaces_fuel_card_id', 'created_by',
    ];

    protected $casts = [
        'effective_from' => 'datetime',
        'effective_until' => 'datetime',
        'per_transaction_milliliters' => 'integer',
        'per_transaction_value_minor' => 'integer',
        'daily_milliliters' => 'integer',
        'daily_value_minor' => 'integer',
        'weekly_milliliters' => 'integer',
        'weekly_value_minor' => 'integer',
        'monthly_milliliters' => 'integer',
        'monthly_value_minor' => 'integer',
        'daily_transaction_count' => 'integer',
        'allowed_time_windows' => 'array',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
        'station_restriction_mode' => self::RESTRICTION_ALL,
        'fuel_restriction_mode' => self::RESTRICTION_ALL,
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('بطاقة الوقود لا تحذف؛ غيّر حالتها للحفاظ على تاريخ التفويض والاستخدام.'));
    }

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }

    public function vehicle(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetVehicle::class, 'fuel_fleet_vehicle_id');
    }

    public function driver(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetDriver::class, 'fuel_fleet_driver_id');
    }

    public function replacedCard(): BelongsTo
    {
        return $this->referenceBelongsTo(self::class, 'replaces_fuel_card_id');
    }

    public function stations(): HasMany
    {
        return $this->hasMany(FuelCardStation::class);
    }

    public function fuelProducts(): HasMany
    {
        return $this->hasMany(FuelCardProduct::class);
    }

    public function usages(): HasMany
    {
        return $this->hasMany(FuelCardUsage::class);
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }

    public function isActiveAt(CarbonInterface $at): bool
    {
        return $this->status === self::STATUS_ACTIVE
            && $this->effective_from->lte($at)
            && ($this->effective_until === null || $this->effective_until->gt($at));
    }
}
