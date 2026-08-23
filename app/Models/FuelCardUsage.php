<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** استعمال بطاقة معتمد بعد finalization؛ مصدر حدود البطاقة الزمنية والتدقيق. */
class FuelCardUsage extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_card_id', 'fuel_sale_id', 'corporate_fuel_contract_id',
        'partner_id', 'fuel_station_id', 'fuel_product_id', 'quantity_milliliters', 'invoice_total_minor', 'occurred_at',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer',
        'invoice_total_minor' => 'integer',
        'occurred_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('استخدام بطاقة الوقود المعتمد immutable.'));
        static::deleting(fn () => throw new LogicException('استخدام بطاقة الوقود المعتمد لا يحذف.'));
    }

    public function card(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelCard::class, 'fuel_card_id');
    }

    public function sale(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelSale::class, 'fuel_sale_id');
    }

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }
}
