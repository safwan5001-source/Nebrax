<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H5 / ADR-17 — كتلة محتوى منتج مهيكلة (نص عادي). النوع من قائمة منصة محدودة؛
 * `saving` يتحقق بنيوياً من النوع ومن ملكية المنتج للمستأجر. معلومات يكتبها التاجر، لا ادّعاء
 * امتثال.
 */
class CommerceProductContentBlock extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const TYPES = [
        'composition', 'care', 'natural_variation', 'included_items', 'dimensions',
        'materials', 'allergens', 'storage', 'preparation_notes', 'personalization_instructions',
    ];

    public const MAX_BODY_LENGTH = 2000;

    protected $fillable = ['tenant_id', 'product_id', 'block_type', 'body', 'body_en', 'is_active', 'sort_order'];

    protected $casts = ['is_active' => 'boolean', 'sort_order' => 'integer'];

    protected $attributes = ['is_active' => true, 'sort_order' => 0];

    protected static function booted(): void
    {
        static::saving(function (self $block) {
            if (! in_array($block->block_type, self::TYPES, true)) {
                throw new RuntimeException('نوع كتلة المحتوى غير مدعوم.');
            }

            $tenantId = $block->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }
            $product = Product::withoutGlobalScopes()->select(['id', 'tenant_id'])->find($block->product_id);
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
