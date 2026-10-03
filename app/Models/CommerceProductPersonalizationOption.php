<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/** FLOWERS-H4a / ADR-16 — خيار داخل مُدخَل تخصيص من نوع `select` (قيمة ثابتة + تسمية ثنائية اللغة). */
class CommerceProductPersonalizationOption extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'field_id', 'value_key', 'label', 'label_en', 'sort_order', 'is_active'];

    protected $casts = ['sort_order' => 'integer', 'is_active' => 'boolean'];

    protected $attributes = ['sort_order' => 0, 'is_active' => true];

    protected static function booted(): void
    {
        static::saving(function (self $option) {
            $tenantId = $option->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }
            $field = CommerceProductPersonalizationField::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id', 'type'])->find($option->field_id);
            if ($field === null || $field->tenant_id !== $tenantId) {
                throw new RuntimeException('مُدخَل التخصيص غير موجود لهذا المستأجر.');
            }
            if ($field->type !== CommerceProductPersonalizationField::TYPE_SELECT) {
                throw new RuntimeException('الخيارات لا تُضاف إلا لمُدخَل من نوع اختيار.');
            }
        });
    }

    public function field(): BelongsTo
    {
        return $this->belongsTo(CommerceProductPersonalizationField::class, 'field_id');
    }
}
