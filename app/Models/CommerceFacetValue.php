<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H2 / ADR-14 — قيمة بُعد: مترجَمة (`name`/`name_en`)، `slug` فريد داخل
 * البُعد، قابلة للتعطيل دون فقد إسناداتها. `saving` يتحقق بنيوياً أن البُعد يخص
 * نفس المستأجر (لا نثق بقيد FK الذي يثبت الوجود لا الملكية).
 */
class CommerceFacetValue extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'commerce_facet_id', 'slug', 'name', 'name_en', 'sort_order', 'is_active'];

    protected $casts = ['sort_order' => 'integer', 'is_active' => 'boolean'];

    protected $attributes = ['sort_order' => 0, 'is_active' => true];

    protected static function booted(): void
    {
        static::saving(function (self $value) {
            if ($value->commerce_facet_id === null) {
                return;
            }

            $tenantId = $value->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $facet = CommerceFacet::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($value->commerce_facet_id);

            if ($facet === null || $facet->tenant_id !== $tenantId) {
                throw new RuntimeException('البُعد غير موجود لهذا المستأجر.');
            }
        });
    }

    public function facet(): BelongsTo
    {
        return $this->belongsTo(CommerceFacet::class, 'commerce_facet_id');
    }
}
