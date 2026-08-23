<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * مطالبة مورد خاصة بالوقود. تحفظ خطوط الفاتورة ومطابقاتها مع الاستلام، ولا
 * تستخدم PurchaseService لأن ذلك المحرك يضيف مخزوناً مع الدائنين في عملية واحدة.
 */
class FuelSupplierInvoice extends BaseModel implements CompanyWide
{
    public const STATUS_UNMATCHED = 'unmatched';
    public const STATUS_PARTIALLY_MATCHED = 'partially_matched';
    public const STATUS_MATCHED = 'matched';
    public const STATUS_VALUE_VARIANCE_PENDING = 'value_variance_pending';

    protected $fillable = [
        'tenant_id', 'supplier_id', 'procurement_order_id', 'purchase_id', 'invoice_number', 'invoice_date', 'currency',
        'status', 'total_quantity_milliliters', 'total_value_minor', 'matched_quantity_milliliters',
        'matched_value_minor', 'created_by', 'reviewed_by', 'reviewed_at', 'evidence', 'notes',
    ];

    protected $casts = [
        'invoice_date' => 'date', 'total_quantity_milliliters' => 'integer', 'total_value_minor' => 'integer',
        'matched_quantity_milliliters' => 'integer', 'matched_value_minor' => 'integer',
        'reviewed_at' => 'datetime', 'evidence' => 'array',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $invoice): void {
            if (! $invoice->matches()->exists()) {
                return;
            }

            $allowed = ['status', 'matched_quantity_milliliters', 'matched_value_minor', 'reviewed_by', 'reviewed_at', 'updated_at'];
            if (array_diff(array_keys($invoice->getDirty()), $allowed) !== []) {
                throw new LogicException('لا يمكن تعديل فاتورة مورد وقود لها مطابقات. أنشئ تدفق تصحيح صريحاً.');
            }
        });
        static::deleting(function (self $invoice): void {
            if ($invoice->matches()->exists()) {
                throw new LogicException('لا يمكن حذف فاتورة مورد وقود لها مطابقات.');
            }
        });
    }

    public function supplier(): BelongsTo { return $this->belongsTo(Partner::class, 'supplier_id'); }
    public function procurementOrder(): BelongsTo { return $this->belongsTo(ProcurementDocument::class, 'procurement_order_id'); }
    public function purchase(): BelongsTo { return $this->belongsTo(Purchase::class); }
    public function lines(): HasMany { return $this->hasMany(FuelSupplierInvoiceLine::class); }
    public function matches(): HasMany { return $this->hasMany(FuelSupplierInvoiceMatch::class); }
}
