<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * AWJ-VD-H1 / VD-1b (§3.2) — the visual identity (L2) of a facet (`commerce_facet_value_id` NULL) or of one of its
 * values. Company-wide like the rest of the commerce catalogue (ADR-14 §2.1): an identity is shared by every surface.
 *
 * `saving` checks structurally — a foreign-key constraint proves existence, not ownership — that the facet belongs
 * to the same tenant and that the value belongs to that facet. Media ownership and readiness are checked by
 * `CommerceFacetVisualService` under row locks (D-16), because they race with media deletion.
 *
 * Written only through `CommerceFacetVisualService`; never deleted by the API (D-17 tombstone), only by cascades.
 */
class CommerceFacetVisual extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'commerce_facet_id', 'commerce_facet_value_id', 'schema_version', 'visual', 'version'];

    protected $casts = ['visual' => 'array', 'schema_version' => 'integer', 'version' => 'integer'];

    protected $attributes = ['schema_version' => 1, 'version' => 1];

    protected static function booted(): void
    {
        static::saving(function (self $visual) {
            $tenantId = $visual->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null || $visual->commerce_facet_id === null) {
                throw new RuntimeException('هوية البُعد تتطلب مستأجراً وبُعداً.');
            }

            $facet = CommerceFacet::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($visual->commerce_facet_id);
            if ($facet === null || $facet->tenant_id !== $tenantId) {
                throw new RuntimeException('البُعد غير موجود لهذا المستأجر.');
            }

            if ($visual->commerce_facet_value_id !== null) {
                $value = CommerceFacetValue::withoutGlobalScope(TenantScope::class)
                    ->select(['id', 'tenant_id', 'commerce_facet_id'])
                    ->find($visual->commerce_facet_value_id);
                if ($value === null || $value->tenant_id !== $tenantId || $value->commerce_facet_id !== $facet->id) {
                    throw new RuntimeException('القيمة لا تتبع هذا البُعد.');
                }
            }
        });
    }

    /**
     * Always store a JSON **object**: the empty document (tombstone, D-17) is `{}`, never the `[]` PHP's empty array
     * would encode to. Reads still decode to an array through the `array` cast.
     */
    public function setVisualAttribute(mixed $value): void
    {
        $this->attributes['visual'] = is_array($value) && $value !== [] ? json_encode($value) : '{}';
    }

    public function facet(): BelongsTo
    {
        return $this->belongsTo(CommerceFacet::class, 'commerce_facet_id');
    }

    public function value(): BelongsTo
    {
        return $this->belongsTo(CommerceFacetValue::class, 'commerce_facet_value_id');
    }

    public function isEmpty(): bool
    {
        return ! is_array($this->visual) || $this->visual === [];
    }
}
