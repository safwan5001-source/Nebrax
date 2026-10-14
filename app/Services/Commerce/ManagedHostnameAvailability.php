<?php

namespace App\Services\Commerce;

use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Support\ManagedStorefrontHostname;
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
}
