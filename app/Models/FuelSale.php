<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * حقيقة بيع الوقود التشغيلية الرسمية. لا ينشئ البيع المسود أي فاتورة أو مخزون
 * أو قيد؛ تنتج هذه الآثار مرة واحدة فقط عند finalization عبر المحركات القائمة.
 */
class FuelSale extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    public const STATUS_DRAFT = 'draft';
    public const STATUS_FINALIZED = 'finalized';
    public const STATUS_VOIDED_DRAFT = 'voided_draft';
    public const STATUSES = [self::STATUS_DRAFT, self::STATUS_FINALIZED, self::STATUS_VOIDED_DRAFT];

    public const PAYMENT_UNPAID = 'unpaid';
    public const PAYMENT_PARTIAL = 'partially_paid';
    public const PAYMENT_PAID = 'paid';
    public const PAYMENT_STATUSES = [self::PAYMENT_UNPAID, self::PAYMENT_PARTIAL, self::PAYMENT_PAID];

    public const ROUNDING_HALF_UP = 'half_up';

    protected $fillable = [
        'tenant_id', 'branch_id', 'number', 'status', 'fuel_station_id', 'warehouse_id', 'fuel_shift_id',
        'fuel_pump_id', 'fuel_nozzle_id', 'fuel_tank_id', 'fuel_product_id', 'product_id', 'partner_id',
        'quantity_milliliters', 'price_per_liter_minor', 'fuel_price_tax_mode', 'pricing_numerator', 'pricing_denominator', 'gross_minor',
        'rounding_remainder_numerator', 'rounding_remainder_denominator', 'rounding_policy',
        'meter_start_milliliters', 'meter_end_milliliters', 'meter_source_reference', 'source_references',
        'invoice_id', 'stock_movement_id', 'cogs_journal_entry_id', 'cogs_minor', 'payment_status', 'paid_minor',
        'corporate_fuel_contract_id', 'corporate_fuel_contract_price_id', 'fuel_card_id', 'fuel_fleet_vehicle_id',
        'fuel_fleet_driver_id', 'corporate_price_source', 'contract_payment_terms_days', 'odometer_snapshot',
        'idempotency_key', 'finalized_at', 'finalized_by', 'created_by',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer',
        'price_per_liter_minor' => 'integer',
        'gross_minor' => 'integer',
        'meter_start_milliliters' => 'integer',
        'meter_end_milliliters' => 'integer',
        'source_references' => 'array',
        'cogs_minor' => 'integer',
        'paid_minor' => 'integer',
        'contract_payment_terms_days' => 'integer',
        'odometer_snapshot' => 'integer',
        'finalized_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $sale): void {
            if ($sale->getOriginal('status') !== self::STATUS_FINALIZED) {
                return;
            }

            $allowed = ['payment_status', 'paid_minor', 'updated_at'];
            if (array_diff(array_keys($sale->getDirty()), $allowed) !== []) {
                throw new LogicException('بيع الوقود النهائي مقفل؛ الدفع يحدث عبر سند قبض مستقل ولا يغير الحقيقة التجارية.');
            }
        });
        static::deleting(function (self $sale): void {
            if ($sale->status !== self::STATUS_DRAFT) {
                throw new LogicException('بيع الوقود النهائي لا يحذف؛ استخدم مستنداً عكسياً معتمداً.');
            }
        });
    }

    public function isDraft(): bool { return $this->status === self::STATUS_DRAFT; }
    public function isFinalized(): bool { return $this->status === self::STATUS_FINALIZED; }

    public function station(): BelongsTo { return $this->referenceBelongsTo(FuelStation::class, 'fuel_station_id'); }
    public function warehouse(): BelongsTo { return $this->referenceBelongsTo(Warehouse::class); }
    public function shift(): BelongsTo { return $this->referenceBelongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function pump(): BelongsTo { return $this->referenceBelongsTo(FuelPump::class, 'fuel_pump_id'); }
    public function nozzle(): BelongsTo { return $this->referenceBelongsTo(FuelNozzle::class, 'fuel_nozzle_id'); }
    public function tank(): BelongsTo { return $this->referenceBelongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function fuelProduct(): BelongsTo { return $this->referenceBelongsTo(FuelProduct::class, 'fuel_product_id'); }
    public function product(): BelongsTo { return $this->referenceBelongsTo(Product::class); }
    public function partner(): BelongsTo { return $this->referenceBelongsTo(Partner::class); }
    public function invoice(): BelongsTo { return $this->referenceBelongsTo(Invoice::class); }
    public function stockMovement(): BelongsTo { return $this->referenceBelongsTo(StockMovement::class); }
    public function cogsJournalEntry(): BelongsTo { return $this->referenceBelongsTo(JournalEntry::class, 'cogs_journal_entry_id'); }
    public function paymentReceipts(): HasMany { return $this->hasMany(FuelSalePaymentReceipt::class); }
    public function corporateContract(): BelongsTo { return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id'); }
    public function corporateContractPrice(): BelongsTo { return $this->referenceBelongsTo(CorporateFuelContractPrice::class, 'corporate_fuel_contract_price_id'); }
    public function fuelCard(): BelongsTo { return $this->referenceBelongsTo(FuelCard::class, 'fuel_card_id'); }
    public function fleetVehicle(): BelongsTo { return $this->referenceBelongsTo(FuelFleetVehicle::class, 'fuel_fleet_vehicle_id'); }
    public function fleetDriver(): BelongsTo { return $this->referenceBelongsTo(FuelFleetDriver::class, 'fuel_fleet_driver_id'); }
    public function finalizer(): BelongsTo { return $this->referenceBelongsTo(User::class, 'finalized_by'); }
    public function creator(): BelongsTo { return $this->referenceBelongsTo(User::class, 'created_by'); }
}
