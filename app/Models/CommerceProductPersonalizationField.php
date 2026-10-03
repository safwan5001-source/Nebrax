<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use RuntimeException;

/**
 * FLOWERS-H4a / ADR-16 — تعريف مُدخَل تخصيص لمنتج (يحدّده التاجر). ليس هوية SKU ولا
 * متغيّراً. المنتج مرجع مخزَّن لا يُصفّى بالفرع؛ `saving` يتحقق بنيوياً من ملكية
 * المنتج للمستأجر ومن النوع المسموح (`image` محجوز لـH4c).
 */
class CommerceProductPersonalizationField extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const TYPE_TEXT = 'text';

    public const TYPE_TEXTAREA = 'textarea';

    public const TYPE_SELECT = 'select';

    public const TYPES = [self::TYPE_TEXT, self::TYPE_TEXTAREA, self::TYPE_SELECT];

    public const MAX_LENGTH_CEILING = 500;

    protected $fillable = [
        'tenant_id', 'product_id', 'key', 'type', 'label', 'label_en', 'help_text',
        'is_required', 'max_length', 'sort_order', 'is_active',
    ];

    protected $casts = [
        'is_required' => 'boolean',
        'max_length' => 'integer',
        'sort_order' => 'integer',
        'is_active' => 'boolean',
    ];

    protected $attributes = ['is_required' => false, 'sort_order' => 0, 'is_active' => true];

    protected static function booted(): void
    {
        static::saving(function (self $field) {
            if (! in_array($field->type, self::TYPES, true)) {
                throw new RuntimeException('نوع مُدخَل التخصيص غير مدعوم.');
            }
            if ($field->max_length !== null && ($field->max_length < 1 || $field->max_length > self::MAX_LENGTH_CEILING)) {
                throw new RuntimeException('الحد الأقصى للطول خارج النطاق المسموح.');
            }

            $tenantId = $field->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }
            $product = Product::withoutGlobalScopes()->select(['id', 'tenant_id'])->find($field->product_id);
            if ($product === null || $product->tenant_id !== $tenantId) {
                throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
            }
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function options(): HasMany
    {
        return $this->hasMany(CommerceProductPersonalizationOption::class, 'field_id')->orderBy('sort_order')->orderBy('label');
    }
}
