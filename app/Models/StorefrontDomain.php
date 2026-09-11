<?php

namespace App\Models;

use App\Support\HostnameNormalizer;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ربط نطاق (hostname) بمتجر Commerce (COM-7-P2A) — مصدر سلطة Tenant/Storefront
 * الوحيد في الإنتاج (AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md
 * §3-7). `hostname` نصٌّ مطبَّع فقط (لا مخطط/مسار/استعلام/منفذ) عبر
 * `setHostnameAttribute()` أدناه — المسار الوحيد الذي يستدعي
 * `HostnameNormalizer` عند التخزين؛ `ResolveStorefrontDomain` يستدعيها
 * مستقلاً عند حسم كل طلب. فريدٌ **عالمياً** لا لكل مستأجر — هو مدخل الحسم،
 * فلا يصح أن يحلّ نفس الاسم إلى مستأجرين (§4).
 *
 * **`CompanyWide`**: مثل `Storefront`/`SalesChannel` — بلا فرع.
 *
 * لا سلطة إنتاجية لأي نطاق قبل `verification_status = verified` — موحّداً
 * لكل الأنواع عمداً (فشلٌ آمن أبسط من تمييز النوع، ولا أتمتة تحقّق DNS في
 * هذه المرحلة أصلاً، §6). يفرضها `ResolveStorefrontDomain` عبر `isVerified()`.
 */
class StorefrontDomain extends BaseModel implements CompanyWide
{
    public const TYPE_AWJ_SUBDOMAIN = 'awj_subdomain';

    public const TYPE_CUSTOM = 'custom';

    public const VERIFICATION_PENDING = 'pending';

    public const VERIFICATION_VERIFIED = 'verified';

    public const VERIFICATION_FAILED = 'failed';

    protected $fillable = [
        'tenant_id', 'storefront_id', 'hostname', 'type', 'is_primary', 'is_active', 'verification_status',
    ];

    protected $casts = [
        'is_primary' => 'boolean',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_primary' => false,
        'is_active' => true,
        'verification_status' => self::VERIFICATION_PENDING,
    ];

    protected static function booted(): void
    {
        static::creating(function (self $domain) {
            if ($domain->hostname !== null
                && static::withoutGlobalScope(TenantScope::class)->where('hostname', $domain->hostname)->exists()
            ) {
                throw new RuntimeException('اسم النطاق مستخدم بالفعل.');
            }
        });

        static::saving(function (self $domain) {
            if ($domain->storefront_id === null) {
                return;
            }

            // انظر تعليق `Storefront::booted()` — نفس سبب القراءة من
            // `TenantContext` عند غياب `tenant_id` وقت الإنشاء.
            $tenantId = $domain->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $storefront = Storefront::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($domain->storefront_id);

            if ($storefront === null || $storefront->tenant_id !== $tenantId) {
                throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
            }
        });
    }

    /** يطبّع hostname عبر المسار المركزي الوحيد قبل أي تخزين — راجع رأس الملف. */
    public function setHostnameAttribute(string $value): void
    {
        $this->attributes['hostname'] = HostnameNormalizer::normalize($value);
    }

    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }

    public function isVerified(): bool
    {
        return $this->verification_status === self::VERIFICATION_VERIFIED;
    }

    /**
     * يجعل هذا النطاق الأساسي **حصرياً** لمتجره — يُنفَّذ في معاملة فلا تمرّ
     * لحظة بنطاقين أساسيين نشطين لنفس المتجر (يمنعها الفهرس الفريد الجزئي
     * أيضاً)، بنفس نمط `Branch::makeMain()` حرفياً.
     */
    public function makePrimary(): void
    {
        DB::transaction(function () {
            static::where('storefront_id', $this->storefront_id)
                ->where('id', '!=', $this->id)
                ->where('is_primary', true)
                ->update(['is_primary' => false]);
            $this->forceFill(['is_primary' => true])->save();
        });
    }
}
