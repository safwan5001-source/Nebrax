<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use RuntimeException;

/**
 * FLOWERS-H2 / ADR-14 — بُعد وصفي قابل للترشيح (مناسبة، مُهدى إليه، نوع الزهرة…).
 *
 * `CompanyWide`: كتالوج المتجر الإلكتروني على مستوى المؤسسة كـ`CommerceListing`.
 * `system_key` (قائمة منصة محدودة) يتيح للأقسام والتهيئة مخاطبة «المناسبة» و«المُهدى
 * إليه» دون تثبيت قيمها في الكود؛ هما صفّان عاديان يعدّلهما التاجر.
 */
class CommerceFacet extends BaseModel implements CompanyWide
{
    public const SYSTEM_OCCASION = 'occasion';

    public const SYSTEM_RECIPIENT = 'recipient';

    public const SYSTEM_KEYS = [self::SYSTEM_OCCASION, self::SYSTEM_RECIPIENT];

    protected $fillable = ['tenant_id', 'key', 'system_key', 'name', 'name_en', 'sort_order', 'is_active'];

    protected $casts = ['sort_order' => 'integer', 'is_active' => 'boolean'];

    protected $attributes = ['sort_order' => 0, 'is_active' => true];

    protected static function booted(): void
    {
        static::saving(function (self $facet) {
            if ($facet->system_key !== null && ! in_array($facet->system_key, self::SYSTEM_KEYS, true)) {
                throw new RuntimeException('مفتاح البُعد النظامي غير معروف.');
            }
        });
    }

    public function values(): HasMany
    {
        return $this->hasMany(CommerceFacetValue::class)->orderBy('sort_order')->orderBy('name');
    }
}
