<?php

namespace App\Models;

use App\Support\Commerce\BusinessVertical;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H1 — ملف نشاط المتجر الحالي (1:1 مع Storefront). غياب الصفّ =
 * `general`، فلا يُنشأ إلا بقرار صريح.
 *
 * `CompanyWide`: تهيئة مستوى المؤسسة كـ`Storefront` نفسه. بلا SoftDeletes
 * (حالة حالية لا سجل تدقيق). `booted()` يتحقق أن المتجر يخص نفس المستأجر
 * بنيوياً، بنفس روح `StorefrontPresentation`.
 */
class StorefrontBusinessProfile extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'storefront_id', 'vertical'];

    protected static function booted(): void
    {
        static::saving(function (self $profile) {
            if (BusinessVertical::tryFrom((string) $profile->vertical) === null) {
                throw new RuntimeException('ملف النشاط غير معروف.');
            }

            if ($profile->storefront_id === null) {
                return;
            }

            $tenantId = $profile->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $storefront = Storefront::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($profile->storefront_id);

            if ($storefront === null || $storefront->tenant_id !== $tenantId) {
                throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
            }
        });
    }

    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }

    public function businessVertical(): BusinessVertical
    {
        return BusinessVertical::fromStored($this->vertical);
    }
}
