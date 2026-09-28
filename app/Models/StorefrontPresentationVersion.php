<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * CUST-H1-1 — نسخة تصميم مستقلّة وقابلة للتحرير لمتجر واحد.
 *
 * `CompanyWide`: تهيئة مستوى المؤسسة كـ`Storefront`/`StorefrontPresentation`
 * أنفسهما — لا فرعاً. بلا SoftDeletes: الحذف حذف منتج لا أثر تدقيق (نفس
 * فلسفة `storefront_presentations`؛ راجع docs/plans/store/
 * CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md §4).
 *
 * لا عمود `status`: حالة النسخة (مسودة/مجدولة/منشورة) تُشتقّ من مؤشرات
 * `storefront_presentations` (`active_version_id`/`scheduled_version_id`)
 * وقت القراءة فقط — أنظر `StorefrontPresentationVersionService::deriveState()`.
 *
 * `booted()` يتحقق أن المتجر المرجو يخصّ نفس المستأجر — بنفس روح
 * `StorefrontPresentation::booted()`، بنيوياً لا عبر الخدمة وحدها.
 */
class StorefrontPresentationVersion extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'storefront_id',
        'name',
        'schema_version',
        'config',
        'revision',
        'scheduled_for',
        'schedule_generation',
        'last_published_at',
    ];

    protected $casts = [
        'schema_version' => 'integer',
        'config' => 'array',
        'revision' => 'integer',
        'scheduled_for' => 'datetime',
        'schedule_generation' => 'integer',
        'last_published_at' => 'datetime',
    ];

    protected $attributes = [
        'revision' => 1,
        'schedule_generation' => 0,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $version) {
            if ($version->storefront_id === null) {
                return;
            }

            $tenantId = $version->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $storefront = Storefront::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($version->storefront_id);

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
