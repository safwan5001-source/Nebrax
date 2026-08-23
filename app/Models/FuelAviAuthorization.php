<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * قرار هوية/تفويض قبل البيع. لا ينشئ قيداً أو فاتورة أو استعمال بطاقة؛ يبقى
 * FuelSaleService المسؤول الوحيد عن الأثر المالي عند finalization.
 */
class FuelAviAuthorization extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public const DECISION_APPROVED = 'approved';
    public const DECISION_DENIED = 'denied';
    public const DECISIONS = [self::DECISION_APPROVED, self::DECISION_DENIED];

    public const MODE_VEHICLE_ONLY = 'vehicle_only';
    public const MODE_DRIVER_ONLY = 'driver_only';
    public const MODE_DUAL = 'vehicle_and_driver';
    public const IDENTITY_MODES = [self::MODE_VEHICLE_ONLY, self::MODE_DRIVER_ONLY, self::MODE_DUAL];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_nozzle_id', 'fuel_product_id',
        'vehicle_identity_tag_id', 'driver_identity_tag_id', 'partner_id', 'corporate_fuel_contract_id',
        'fuel_card_id', 'fuel_fleet_vehicle_id', 'fuel_fleet_driver_id', 'fuel_sale_id', 'identity_mode',
        'quantity_milliliters', 'odometer', 'idempotency_key', 'payload_checksum', 'decision',
        'reason_code', 'suspicion_signals', 'authorized_at', 'expires_at', 'finalization_checked_at',
        'requested_by',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer',
        'odometer' => 'integer',
        'suspicion_signals' => 'array',
        'authorized_at' => 'datetime',
        'expires_at' => 'datetime',
        'finalization_checked_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $authorization): void {
            $allowed = ['fuel_sale_id', 'finalization_checked_at', 'updated_at'];
            if (array_diff(array_keys($authorization->getDirty()), $allowed) !== []) {
                throw new LogicException('قرار تفويض AVI/RFID غير قابل للتعديل؛ أنشئ محاولة جديدة للحفاظ على أثر المراجعة.');
            }
        });
        static::deleting(fn () => throw new LogicException('قرار تفويض AVI/RFID لا يحذف؛ يبقى دليلاً على القرار وسببه.'));
    }

    public function station(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function nozzle(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelNozzle::class, 'fuel_nozzle_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelProduct::class, 'fuel_product_id');
    }

    public function vehicleIdentityTag(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelAviIdentityTag::class, 'vehicle_identity_tag_id');
    }

    public function driverIdentityTag(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelAviIdentityTag::class, 'driver_identity_tag_id');
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

    public function sale(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelSale::class, 'fuel_sale_id');
    }

    public function requester(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'requested_by');
    }

    public function isApproved(): bool
    {
        return $this->decision === self::DECISION_APPROVED;
    }

    public function isExpiredAt(CarbonInterface $at): bool
    {
        return $this->expires_at !== null && ! $this->expires_at->gt($at);
    }
}
