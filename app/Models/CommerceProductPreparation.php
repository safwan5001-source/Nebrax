<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H8 / ADR-20 — مهلة تجهيز منتجٍ بالدقائق (0…43 200). مدخلٌ لاشتقاق وعد التسليم فقط: لا مخزون ولا سعر
 * ولا أثر محاسبي. صف واحد لكل منتج؛ الغياب يعني «بلا مهلة خاصة» (مهلة القناة وحدها).
 */
class CommerceProductPreparation extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const MAX_MINUTES = 43200;

    protected $fillable = ['tenant_id', 'product_id', 'preparation_minutes'];

    protected $casts = ['preparation_minutes' => 'integer'];

    protected static function booted(): void
    {
        static::saving(function (self $row) {
            if ($row->preparation_minutes < 1 || $row->preparation_minutes > self::MAX_MINUTES) {
                throw new RuntimeException('مهلة التجهيز خارج المدى المسموح.');
            }

            $tenantId = $row->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }
            $product = Product::withoutGlobalScopes()->select(['id', 'tenant_id'])->find($row->product_id);
            if ($product === null || $product->tenant_id !== $tenantId) {
                throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
            }
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }
}
