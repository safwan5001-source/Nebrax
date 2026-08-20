<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * تصنيف تحليلي مُدار للعميل أو المورد أو نوع مستند محدد.
 *
 * لا يختار حساباً ولا يولّد قيداً؛ أثره في الفلترة والتجميع والتحليل فقط.
 */
class Classification extends BaseModel implements BranchShareable
{
    use BranchScoped;
    use SoftDeletes;

    public const SCOPES = [
        'customer',
        'supplier',
        'sales_invoice',
        'purchase_invoice',
        'receipt',
        'payment',
    ];

    protected $fillable = [
        'tenant_id', 'branch_id', 'scope', 'name', 'description', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    /** تصنيفات العميل والمورد تتبع مفاتيح مشاركة الأطراف؛ غيرها تشغيلي بالفرع. */
    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        $customers = $sharing->shared('share_customers');
        $suppliers = $sharing->shared('share_suppliers');

        if ($customers && $suppliers) {
            return fn (Builder $query) => $query->whereIn('classifications.scope', [
                'customer', 'supplier',
            ]);
        }

        if (! $customers && ! $suppliers) {
            return false;
        }

        $sharedScope = $customers ? 'customer' : 'supplier';

        return fn (Builder $query) => $query->where('classifications.scope', $sharedScope);
    }

    public function customerPartners(): HasMany
    {
        return $this->hasMany(Partner::class, 'customer_classification_id');
    }

    public function supplierPartners(): HasMany
    {
        return $this->hasMany(Partner::class, 'supplier_classification_id');
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class, 'classification_id');
    }

    public function purchases(): HasMany
    {
        return $this->hasMany(Purchase::class, 'classification_id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class, 'classification_id');
    }
}
