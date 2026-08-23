<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * استلام وقود تشغيلي: مسودة أدلة ثم اعتماد لا رجعة فيه يُدخل الكمية المستلمة
 * إلى مخزن المحطة ويثبت مقابلاً في GRNI. لا تمثل الفاتورة ولا تخلق دائناً.
 */
class FuelDelivery extends BaseModel
{
    use BranchScoped;

    public const STATUS_DRAFT = 'draft';
    public const STATUS_APPROVED = 'approved';

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_tank_id', 'fuel_product_id', 'warehouse_id',
        'supplier_id', 'procurement_order_id', 'purchase_reference', 'delivery_note_number',
        'tanker_identifier', 'driver_name', 'compartments', 'dispatched_milliliters', 'received_milliliters',
        'transit_variance_milliliters', 'temperature_milli_celsius', 'density_kg_per_m3',
        'before_physical_reading_id', 'after_physical_reading_id', 'before_atg_reading_id', 'after_atg_reading_id',
        'evidence', 'status', 'received_unit_cost_minor', 'received_total_cost_minor', 'grni_account_id',
        'stock_movement_id', 'journal_entry_id', 'fuel_operational_ledger_id', 'idempotency_key',
        'received_at', 'created_by', 'approved_by', 'approved_at', 'notes',
    ];

    protected $casts = [
        'compartments' => 'array', 'evidence' => 'array', 'dispatched_milliliters' => 'integer',
        'received_milliliters' => 'integer', 'transit_variance_milliliters' => 'integer',
        'temperature_milli_celsius' => 'integer', 'density_kg_per_m3' => 'integer',
        'received_unit_cost_minor' => 'integer', 'received_total_cost_minor' => 'integer',
        'received_at' => 'datetime', 'approved_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $delivery): void {
            if ($delivery->getOriginal('status') === self::STATUS_APPROVED) {
                throw new LogicException('لا يمكن تعديل استلام وقود معتمد. استخدم تدفق تصحيح أو عكس صريحاً.');
            }
        });
        static::deleting(function (self $delivery): void {
            if ($delivery->status === self::STATUS_APPROVED) {
                throw new LogicException('لا يمكن حذف استلام وقود معتمد.');
            }
        });
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function supplier(): BelongsTo { return $this->belongsTo(Partner::class, 'supplier_id'); }
    public function procurementOrder(): BelongsTo { return $this->belongsTo(ProcurementDocument::class, 'procurement_order_id'); }
    public function beforePhysicalReading(): BelongsTo { return $this->belongsTo(FuelTankReading::class, 'before_physical_reading_id'); }
    public function afterPhysicalReading(): BelongsTo { return $this->belongsTo(FuelTankReading::class, 'after_physical_reading_id'); }
    public function beforeAtgReading(): BelongsTo { return $this->belongsTo(FuelTankReading::class, 'before_atg_reading_id'); }
    public function afterAtgReading(): BelongsTo { return $this->belongsTo(FuelTankReading::class, 'after_atg_reading_id'); }
    public function grniAccount(): BelongsTo { return $this->belongsTo(Account::class, 'grni_account_id'); }
    public function stockMovement(): BelongsTo { return $this->belongsTo(StockMovement::class); }
    public function journalEntry(): BelongsTo { return $this->belongsTo(JournalEntry::class); }
    public function operationalLedger(): BelongsTo { return $this->belongsTo(FuelOperationalLedger::class, 'fuel_operational_ledger_id'); }
    public function matches(): HasMany { return $this->hasMany(FuelSupplierInvoiceMatch::class); }
}
