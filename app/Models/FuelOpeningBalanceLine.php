<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سطر رصيد افتتاحي للوقود: خزان واحد بكمية صحيحة بالمللتر. التكلفة تُدخل للمنتج (لا للخزان) وتُنسخ على سطور منتجه؛
 * `value_minor` يُحسب ويُثبَّت عند الترحيل فقط. السطر يتجمّد بترحيل رأسه.
 */
class FuelOpeningBalanceLine extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_opening_balance_id', 'fuel_tank_id', 'fuel_product_id', 'position',
        'quantity_milliliters', 'unit_cost_per_liter_minor', 'value_minor', 'stock_movement_id', 'fuel_operational_ledger_id',
    ];

    protected $casts = [
        'position' => 'integer',
        'quantity_milliliters' => 'integer',
        'unit_cost_per_liter_minor' => 'integer',
        'value_minor' => 'integer',
    ];

    protected static function booted(): void
    {
        $guard = function (self $line): void {
            $status = FuelOpeningBalance::query()->whereKey($line->fuel_opening_balance_id)->value('status');
            if ($status === FuelOpeningBalance::STATUS_POSTED) {
                throw new LogicException('سطور رصيد الوقود الافتتاحي المرحَّل ثابتة.');
            }
        };
        static::updating($guard);
        static::deleting($guard);
    }

    public function document(): BelongsTo { return $this->belongsTo(FuelOpeningBalance::class, 'fuel_opening_balance_id'); }
    public function tank(): BelongsTo { return $this->referenceBelongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function fuelProduct(): BelongsTo { return $this->referenceBelongsTo(FuelProduct::class, 'fuel_product_id'); }
    public function stockMovement(): BelongsTo { return $this->referenceBelongsTo(StockMovement::class); }
    public function ledgerEntry(): BelongsTo { return $this->referenceBelongsTo(FuelOperationalLedger::class, 'fuel_operational_ledger_id'); }
}
