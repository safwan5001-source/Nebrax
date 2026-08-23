<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use LogicException;

/**
 * الدفتر التشغيلي التفصيلي لمحطات الوقود. الصفوف لا تعدل ولا تحذف؛ التصحيح
 * صف جديد معاكس مصدره تسوية مصححة لاحقة. StockMovement هو دفتر Nebrax الرسمي.
 */
class FuelOperationalLedger extends BaseModel
{
    use BelongsToBranch;

    public const TYPE_OPENING = 'opening';
    public const TYPE_DELIVERY = 'delivery';
    public const TYPE_SALE = 'sale';
    public const TYPE_TRANSFER_IN = 'transfer_in';
    public const TYPE_TRANSFER_OUT = 'transfer_out';
    public const TYPE_ADJUSTMENT_GAIN = 'adjustment_gain';
    public const TYPE_ADJUSTMENT_LOSS = 'adjustment_loss';
    public const TYPE_EVAPORATION = 'evaporation';
    public const TYPE_STOCKTAKE = 'stocktake';
    public const TYPE_RECONCILIATION_MATCHED = 'reconciliation_matched';

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_tank_id', 'fuel_product_id', 'warehouse_id',
        'fuel_reconciliation_id', 'stock_movement_id', 'movement_type', 'quantity_milliliters',
        'book_balance_milliliters', 'unit_cost_minor', 'value_minor', 'idempotency_key',
        'source_type', 'source_id', 'occurred_at', 'notes',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer', 'book_balance_milliliters' => 'integer',
        'unit_cost_minor' => 'integer', 'value_minor' => 'integer', 'occurred_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Fuel operational ledger entries are immutable.'));
        static::deleting(fn () => throw new LogicException('Fuel operational ledger entries cannot be deleted.'));
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function reconciliation(): BelongsTo { return $this->belongsTo(FuelReconciliation::class, 'fuel_reconciliation_id'); }
    public function stockMovement(): BelongsTo { return $this->belongsTo(StockMovement::class); }
    public function source(): MorphTo { return $this->morphTo(); }
}
