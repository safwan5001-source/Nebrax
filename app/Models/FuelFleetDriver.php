<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** سائق أسطول مستقل؛ employee_id اختياري فقط للسائق الداخلي. */
class FuelFleetDriver extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_SUSPENDED, self::STATUS_INACTIVE];

    protected $fillable = [
        'tenant_id', 'partner_id', 'corporate_fuel_contract_id', 'employee_id', 'name', 'identifier',
        'mobile', 'status', 'created_by',
    ];

    protected $attributes = ['status' => self::STATUS_ACTIVE];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('سائق الأسطول لا يحذف؛ عطّله للحفاظ على تاريخ التفويض والاستخدام.'));
    }

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }

    public function employee(): BelongsTo
    {
        return $this->referenceBelongsTo(Employee::class);
    }

    public function vehicleAssignments(): HasMany
    {
        return $this->hasMany(FuelFleetDriverVehicle::class);
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
