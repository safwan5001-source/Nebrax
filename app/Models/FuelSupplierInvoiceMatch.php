<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * جزء موثق من مطابقة سطر فاتورة المورد باستلام وقود معتمد. القيد، إن وجد،
 * يصف Dr GRNI / Cr Payable للقيمة المطابقة فقط؛ فرق القيمة يبقى pending بلا قيد.
 */
class FuelSupplierInvoiceMatch extends BaseModel
{
    use BranchScoped;

    public const STATUS_MATCHED = 'matched';
    public const STATUS_VALUE_VARIANCE_PENDING = 'value_variance_pending';

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_supplier_invoice_id', 'fuel_supplier_invoice_line_id', 'fuel_delivery_id',
        'supplier_id', 'fuel_station_id', 'fuel_tank_id', 'fuel_product_id', 'warehouse_id', 'grni_account_id',
        'matched_quantity_milliliters', 'matched_receipt_value_minor', 'matched_invoice_value_minor',
        'value_variance_minor', 'quantity_variance_milliliters', 'variance_direction', 'currency', 'status',
        'cleared_value_minor', 'journal_entry_id', 'idempotency_key', 'created_by', 'reviewed_by', 'reviewed_at',
    ];

    protected $casts = [
        'matched_quantity_milliliters' => 'integer', 'matched_receipt_value_minor' => 'integer',
        'matched_invoice_value_minor' => 'integer', 'value_variance_minor' => 'integer',
        'quantity_variance_milliliters' => 'integer', 'cleared_value_minor' => 'integer', 'reviewed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('مطابقة فاتورة الوقود سجل محاسبي ثابت لا يعدّل.'));
        static::deleting(fn () => throw new LogicException('مطابقة فاتورة الوقود لا تحذف؛ التصحيح بتدفق صريح.'));
    }

    public function invoice(): BelongsTo { return $this->belongsTo(FuelSupplierInvoice::class, 'fuel_supplier_invoice_id'); }
    public function invoiceLine(): BelongsTo { return $this->belongsTo(FuelSupplierInvoiceLine::class, 'fuel_supplier_invoice_line_id'); }
    public function delivery(): BelongsTo { return $this->belongsTo(FuelDelivery::class, 'fuel_delivery_id'); }
    public function supplier(): BelongsTo { return $this->belongsTo(Partner::class, 'supplier_id'); }
    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function grniAccount(): BelongsTo { return $this->belongsTo(Account::class, 'grni_account_id'); }
    public function journalEntry(): BelongsTo { return $this->belongsTo(JournalEntry::class); }
}
