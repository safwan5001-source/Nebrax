<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سعر لتر عقدي صريح ومؤرخ؛ لا يرث VAT ديناميكياً من إعداد المحطة. */
class CorporateFuelContractPrice extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_INACTIVE];

    public const TAX_INCLUSIVE = 'tax_inclusive';
    public const TAX_EXCLUSIVE = 'tax_exclusive';
    public const TAX_MODES = [self::TAX_INCLUSIVE, self::TAX_EXCLUSIVE];

    protected $fillable = [
        'tenant_id', 'corporate_fuel_contract_id', 'fuel_product_id', 'price_per_liter_minor',
        'tax_mode', 'effective_from', 'effective_until', 'status', 'created_by', 'approved_by', 'reason',
    ];

    protected $casts = [
        'price_per_liter_minor' => 'integer',
        'effective_from' => 'datetime',
        'effective_until' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('سعر عقد الوقود المؤرخ لا يعدّل؛ أنشئ نسخة فعالية جديدة.'));
        static::deleting(fn () => throw new LogicException('سعر عقد الوقود المؤرخ لا يحذف؛ يبقى دليلاً على التسعير التاريخي.'));
    }

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelProduct::class);
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }

    public function approver(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'approved_by');
    }
}
