<?php

namespace App\Services\Commerce;

use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use Illuminate\Validation\ValidationException;
use App\Tenancy\TenantScope;

/**
 * تفرّد عالمي لمضيفات المتاجر المُدارة (الخيار A) — قراءة فقط.
 *
 * مضيف `X.{base}` محجوز إن (1) وُجد صف `storefront_domains` بهذا الاسم لأي مستأجر،
 * أو (2) كانت `X` سلاج مستأجر (ولو لم يُزوَّد متجره الأول بعد) — فالمتجر الأول
 * يملك `{tenant-slug}.{base}` حصراً. يغلق هذا تصادم الدمج بالشرطة
 * (`a`+`b-c` مقابل مستأجر `a-b-c`) قبل أن يحدث بدل اكتشافه عند تزويد المتجر الأول.
 *
 * بحثٌ عالمي مقصود (مفتاح التفرّد عالمي)؛ لا يُرجع أي بيانات مستأجر — منطقي فقط.
 */
final class ManagedHostnameAvailability
{
    public function isTaken(string $hostname, string $baseDomain): bool
    {
        if (StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $hostname)->exists()) {
            return true;
        }

        $label = ManagedStorefrontHostname::labelOf($hostname, $baseDomain);
        if ($label === null) {
            return true; // خارج الصيغة المسموحة = غير متاح (فشل مغلق)
        }

        // withTrashed: `tenants.slug` يبقى فريداً على مستوى القاعدة حتى بعد الحذف الناعم.
        return Tenant::withTrashed()->where('slug', $label)->exists();
    }

    /**
     * هل سلاج مستأجر جديد يصطدم بمضيف مُدار قائم (`awj_subdomain`) — المتجر الأول يملك
     * `{slug}.{base}` حصراً. بيئة بلا نطاق متاجر مضبوط أو سلاج لا يصلح كشريحة = لا تصادم.
     * صفوف `custom` لا تغيّر عقد التسجيل القائم.
     */
    public function tenantSlugCollidesWithManagedHost(string $slug): bool
    {
        try {
            $hostname = ManagedStorefrontHostname::forSlug($slug);
        } catch (StorefrontBaseDomainMisconfiguredException) {
            return false;
        }

        return StorefrontDomain::withoutGlobalScope(TenantScope::class)
            ->where('hostname', $hostname)
            ->where('type', StorefrontDomain::TYPE_AWJ_SUBDOMAIN)
            ->exists();
    }

    /** يُستدعى داخل معاملة التسجيل **بعد** `ManagedHostNamespaceLock::shared()`. */
    public function assertTenantSlugFree(string $slug): void
    {
        if ($this->tenantSlugCollidesWithManagedHost($slug)) {
            throw ValidationException::withMessages(['slug' => 'هذا المعرّف غير متاح.']);
        }
    }
}
