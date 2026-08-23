<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** لقطة تدقيقية غير قابلة للتعديل لانتقال Cost Pool والباقي المحمول. */
class FuelInventoryCostMovement extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'warehouse_id', 'fuel_product_id', 'stock_movement_id', 'journal_entry_id', 'fuel_delivery_id', 'movement_type',
        'quantity_milliliters', 'posted_cost_minor', 'cost_pool_minor_before', 'cost_numerator_before', 'cost_denominator_before', 'quantity_milliliters_before',
        'carry_remainder_numerator_before', 'carry_remainder_denominator_before', 'cost_pool_minor_after', 'cost_numerator_after', 'cost_denominator_after',
        'quantity_milliliters_after', 'carry_remainder_numerator_after', 'carry_remainder_denominator_after',
        'occurred_at',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer', 'posted_cost_minor' => 'integer',
        'cost_pool_minor_before' => 'integer', 'quantity_milliliters_before' => 'integer',
        'cost_pool_minor_after' => 'integer', 'quantity_milliliters_after' => 'integer',
        'occurred_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حركات تكلفة الوقود سجلات تدقيقية ثابتة.'));
        static::deleting(fn () => throw new LogicException('حركات تكلفة الوقود لا تحذف.'));
    }

    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class); }
    public function stockMovement(): BelongsTo { return $this->belongsTo(StockMovement::class); }
    public function journalEntry(): BelongsTo { return $this->belongsTo(JournalEntry::class); }
    public function delivery(): BelongsTo { return $this->belongsTo(FuelDelivery::class, 'fuel_delivery_id'); }
}
