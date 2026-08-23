<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** قراءة عداد مركبة مؤرخة؛ التصحيح يبنى لاحقاً كسجل مستقل لا بتعديل التاريخ. */
class FuelVehicleOdometerReading extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'fuel_fleet_vehicle_id', 'fuel_sale_id', 'odometer', 'source', 'recorded_by', 'recorded_at',
    ];

    protected $casts = ['odometer' => 'integer', 'recorded_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('قراءة عداد المركبة المعتمدة immutable.'));
        static::deleting(fn () => throw new LogicException('قراءة عداد المركبة المعتمدة لا تحذف.'));
    }

    public function vehicle(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetVehicle::class, 'fuel_fleet_vehicle_id');
    }

    public function sale(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelSale::class, 'fuel_sale_id');
    }

    public function recorder(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'recorded_by');
    }
}
