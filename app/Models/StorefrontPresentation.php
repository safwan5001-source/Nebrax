<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * STORE-BACKEND-1 — رأس مظهر المتجر الحالي (1:1 مع Storefront).
 *
 * `CompanyWide`: تهيئة مستوى المؤسسة كـ`Storefront` نفسه — لا فرعاً.
 * بلا SoftDeletes: الصفّ حالة حالية لا أثر تدقيق. حذف المتجر يتتابع cascade.
 *
 * `booted()` يتحقق أن المتجر المرجو يخص نفس المستأجر — بنفس روح
 * `StorefrontDomain::booted()`، بنيوياً لا عبر الخدمة وحدها.
 */
class StorefrontPresentation extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'storefront_id',
        'schema_version',
        'draft_config',
        'draft_revision',
        'published_config',
        'published_revision',
        'published_at',
    ];

    protected $casts = [
        'schema_version' => 'integer',
        'draft_config' => 'array',
        'draft_revision' => 'integer',
        'published_config' => 'array',
        'published_revision' => 'integer',
        'published_at' => 'datetime',
    ];

    protected $attributes = [
        'schema_version' => 1,
        'draft_revision' => 0,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $presentation) {
            if ($presentation->storefront_id === null) {
                return;
            }

            $tenantId = $presentation->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $storefront = Storefront::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($presentation->storefront_id);

            if ($storefront === null || $storefront->tenant_id !== $tenantId) {
                throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
            }
        });
    }

    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }
}
