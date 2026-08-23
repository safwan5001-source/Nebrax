<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * هوية AVI/RFID محايدة عن المورّد. لا تخزن قيمة الوسم الخام ولا تمثل بطاقة
 * الوقود المنطقية أو الدفعة؛ ترتبط بها فقط عند الحاجة إلى سياسة Cycle 6.
 */
class FuelAviIdentityTag extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const TYPE_VEHICLE_RFID = 'vehicle_rfid';
    public const TYPE_DRIVER_CARD = 'driver_card';
    public const TYPE_VEHICLE_QR = 'vehicle_qr';
    public const TYPE_DRIVER_QR = 'driver_qr';
    public const TYPE_VEHICLE_PIN = 'vehicle_pin';
    public const TYPE_DRIVER_PIN = 'driver_pin';

    public const IDENTITY_TYPES = [
        self::TYPE_VEHICLE_RFID,
        self::TYPE_DRIVER_CARD,
        self::TYPE_VEHICLE_QR,
        self::TYPE_DRIVER_QR,
        self::TYPE_VEHICLE_PIN,
        self::TYPE_DRIVER_PIN,
    ];

    public const VEHICLE_IDENTITY_TYPES = [
        self::TYPE_VEHICLE_RFID,
        self::TYPE_VEHICLE_QR,
        self::TYPE_VEHICLE_PIN,
    ];

    public const DRIVER_IDENTITY_TYPES = [
        self::TYPE_DRIVER_CARD,
        self::TYPE_DRIVER_QR,
        self::TYPE_DRIVER_PIN,
    ];

    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUS_LOST = 'lost';
    public const STATUS_BLACKLISTED = 'blacklisted';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_REPLACED = 'replaced';

    public const STATUSES = [
        self::STATUS_ACTIVE,
        self::STATUS_SUSPENDED,
        self::STATUS_LOST,
        self::STATUS_BLACKLISTED,
        self::STATUS_EXPIRED,
        self::STATUS_CANCELLED,
        self::STATUS_REPLACED,
    ];

    protected $fillable = [
        'tenant_id', 'public_identifier', 'credential_hash', 'identity_type', 'partner_id',
        'corporate_fuel_contract_id', 'fuel_card_id', 'fuel_fleet_vehicle_id',
        'fuel_fleet_driver_id', 'status', 'effective_from', 'effective_until',
        'replaces_fuel_avi_identity_tag_id', 'created_by',
    ];

    protected $casts = [
        'effective_from' => 'datetime',
        'effective_until' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('وسم الهوية الذكي لا يحذف؛ غيّر حالته للحفاظ على تاريخ التفويض.'));
    }

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }

    public function fuelCard(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelCard::class);
    }

    public function vehicle(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetVehicle::class, 'fuel_fleet_vehicle_id');
    }

    public function driver(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetDriver::class, 'fuel_fleet_driver_id');
    }

    public function replacedTag(): BelongsTo
    {
        return $this->referenceBelongsTo(self::class, 'replaces_fuel_avi_identity_tag_id');
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }

    public function vehicleAuthorizations(): HasMany
    {
        return $this->hasMany(FuelAviAuthorization::class, 'vehicle_identity_tag_id');
    }

    public function driverAuthorizations(): HasMany
    {
        return $this->hasMany(FuelAviAuthorization::class, 'driver_identity_tag_id');
    }

    public function isVehicleIdentity(): bool
    {
        return in_array($this->identity_type, self::VEHICLE_IDENTITY_TYPES, true);
    }

    public function isDriverIdentity(): bool
    {
        return in_array($this->identity_type, self::DRIVER_IDENTITY_TYPES, true);
    }

    public function isActiveAt(CarbonInterface $at): bool
    {
        return $this->status === self::STATUS_ACTIVE
            && $this->effective_from->lte($at)
            && ($this->effective_until === null || $this->effective_until->gt($at));
    }
}
