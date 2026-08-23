<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class FuelSupplierInvoiceLine extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'fuel_supplier_invoice_id', 'fuel_product_id', 'line_number', 'quantity_milliliters',
        'value_minor', 'matched_quantity_milliliters', 'matched_value_minor',
    ];

    protected $casts = [
        'line_number' => 'integer', 'quantity_milliliters' => 'integer', 'value_minor' => 'integer',
        'matched_quantity_milliliters' => 'integer', 'matched_value_minor' => 'integer',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $line): void {
            if (! $line->matches()->exists()) {
                return;
            }

            $allowed = ['matched_quantity_milliliters', 'matched_value_minor', 'updated_at'];
            if (array_diff(array_keys($line->getDirty()), $allowed) !== []) {
                throw new LogicException('لا يمكن تعديل سطر فاتورة مورد تمت مطابقته.');
            }
        });
        static::deleting(function (self $line): void {
            if ($line->matches()->exists()) {
                throw new LogicException('لا يمكن حذف سطر فاتورة مورد تمت مطابقته.');
            }
        });
    }

    public function invoice(): BelongsTo { return $this->belongsTo(FuelSupplierInvoice::class, 'fuel_supplier_invoice_id'); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class); }
    public function matches(): HasMany { return $this->hasMany(FuelSupplierInvoiceMatch::class); }
}
