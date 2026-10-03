<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H4b / ADR-16 — قيمة تخصيص على سطر سلة. لقطة تسمية + نوع + قيمة نص عادي؛ لا
 * مفتاح أجنبي نحو التعريف الحي (تعديل التعريف لا يكسر السلة).
 */
class CommerceCartItemPersonalization extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'cart_item_id', 'field_key', 'field_type', 'label', 'label_en', 'value', 'value_label', 'sort_order'];

    protected $casts = ['sort_order' => 'integer'];

    protected static function booted(): void
    {
        static::saving(function (self $row) {
            $tenantId = $row->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }
            $item = CommerceCartItem::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($row->cart_item_id);
            if ($item === null || $item->tenant_id !== $tenantId) {
                throw new RuntimeException('سطر السلة غير موجود لهذا المستأجر.');
            }
        });
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(CommerceCartItem::class, 'cart_item_id');
    }
}
