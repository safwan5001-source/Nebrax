<?php

namespace App\Models;

use App\Services\Commerce\StorefrontPublishedMediaIndex;
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
        'draft_schema_version',
        'published_schema_version',
        'schedule_epoch',
        'active_version_id',
        'scheduled_version_id',
        'compatibility_working_version_id',
    ];

    protected $casts = [
        'schema_version' => 'integer',
        'draft_config' => 'array',
        'draft_revision' => 'integer',
        'published_config' => 'array',
        'published_revision' => 'integer',
        'published_at' => 'datetime',
        'draft_schema_version' => 'integer',
        'published_schema_version' => 'integer',
        'schedule_epoch' => 'integer',
    ];

    protected $attributes = [
        'schema_version' => 1,
        'draft_revision' => 0,
        'schedule_epoch' => 0,
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

        // CUST-HV V2c — مجموعة الوسائط المنشورة تتبع `published_config` دائماً،
        // أياً كان مسار الكتابة (V0 §7.8). نقطة اختناقٍ واحدة لا نداءٌ في كل خدمة.
        static::saved(function (self $presentation) {
            if ($presentation->wasRecentlyCreated || $presentation->wasChanged('published_config')) {
                app(StorefrontPublishedMediaIndex::class)->rebuild($presentation);
            }
        });
    }

    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }

    public function activeVersion(): BelongsTo
    {
        return $this->belongsTo(StorefrontPresentationVersion::class, 'active_version_id');
    }

    public function scheduledVersion(): BelongsTo
    {
        return $this->belongsTo(StorefrontPresentationVersion::class, 'scheduled_version_id');
    }

    public function compatibilityWorkingVersion(): BelongsTo
    {
        return $this->belongsTo(StorefrontPresentationVersion::class, 'compatibility_working_version_id');
    }
}
