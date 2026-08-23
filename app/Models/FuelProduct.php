<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * مواصفة وقود مشتركة على مستوى المؤسسة.
 *
 * المنتج المرتبط هو مصدر وحدة المخزون والضريبة وخرائط الحسابات القائمة؛ لا يخلق
 * هذا النموذج مخزوناً أو سعراً أو أثراً مالياً مستقلاً.
 */
class FuelProduct extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'code', 'name', 'density_kg_per_m3',
        'tax_category', 'is_active',
    ];

    protected $casts = [
        'density_kg_per_m3' => 'integer',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function tanks(): HasMany
    {
        return $this->hasMany(FuelTank::class);
    }

    public function nozzles(): HasMany
    {
        return $this->hasMany(FuelNozzle::class);
    }
}
