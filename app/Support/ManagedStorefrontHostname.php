<?php

namespace App\Support;

/**
 * حدّ الثقة لنطاقات Commerce المُدارة من AWJ (`StorefrontDomain::TYPE_AWJ_SUBDOMAIN`)
 * — COM-STORE-PROVISION-1.
 *
 * المصدر الوحيد الذي يبني ويثبّت hostname `{tenant-slug}.{managed-base-domain}`.
 * **ممنوع** بناء هذا النص في أي مكان آخر (متحكّم/خدمة) — أي منطق سلسلة نصية
 * جديد لبناء نطاق مُدار مكانه هنا فقط، بنفس روح `HostnameNormalizer` الذي
 * يُستدعى منه حصراً.
 *
 * فرقٌ جوهري عن `HostnameNormalizer::normalize()` وحدها: تلك تطبّع نصاً واحداً
 * إلى hostname صالح تركيبياً، لكنها لا تُثبت أن الناتج **تحت** نطاق أساسٍ
 * بعينه. سلسلة كـ`store.awjdev.xyz.evil.com` أو `evilstore.awjdev.xyz` نصٌّ
 * صالح تركيبياً تماماً — الثبوت هنا صريحٌ وإضافي: النطاق الأساسي المطبَّع يجب
 * أن يكون **لاحقة تسمية كاملة** (بعد نقطة)، لا مجرد سلسلة فرعية نصية.
 */
final class ManagedStorefrontHostname
{
    /**
     * النطاق الأساسي المُهيَّأ (`config('storefront.managed_base_domain')`)
     * بعد تطبيعه والتحقق من صلاحيته. يفشل مغلقاً — لا نطاق مشوَّه ولا فارغ
     * يمرّ لأي استدعاء لاحق.
     */
    public static function configuredBaseDomain(): string
    {
        $raw = config('storefront.managed_base_domain');

        if (! is_string($raw) || trim($raw) === '') {
            throw new StorefrontBaseDomainMisconfiguredException(
                'النطاق الأساسي لمتاجر Commerce المُدارة غير مضبوط.'
            );
        }

        return self::normalizeBaseDomain($raw);
    }

    private static function normalizeBaseDomain(string $raw): string
    {
        // Wildcard مثل `*.store.awjdev.xyz` قد يُدخَل بالخطأ من إعداد نطاق
        // DNS منسوخ حرفياً — القيمة المطلوبة هنا نطاقٌ أساسي فقط بلا `*`،
        // وHostnameNormalizer لا يرفض `*` لأنها ليست جزءاً من محارف hostname
        // المسموحة أصلاً (سترفضها بالفعل)، لكن نتحقق صراحةً برسالة أوضح.
        if (str_contains($raw, '*')) {
            throw new StorefrontBaseDomainMisconfiguredException(
                'النطاق الأساسي لمتاجر Commerce المُدارة لا يقبل صيغة wildcard.'
            );
        }

        try {
            return HostnameNormalizer::normalize($raw);
        } catch (InvalidHostnameException $e) {
            throw new StorefrontBaseDomainMisconfiguredException(
                'النطاق الأساسي لمتاجر Commerce المُدارة غير صالح: '.$e->getMessage()
            );
        }
    }

    /**
     * hostname المتجر المُدار لمستأجر بعينه — `{slug}.{baseDomain}` بعد
     * تطبيعه عبر `HostnameNormalizer` (نفس مسار `StorefrontDomain::setHostnameAttribute()`).
     * سلاج غير صالح كـhostname (محارف بحق `alpha_dash` كـ`_` مثلاً) يفشل
     * مغلقاً هنا — لا تخمين ولا تصحيح صامت.
     */
    public static function forSlug(string $tenantSlug, ?string $baseDomain = null): string
    {
        // يمرّ كلا المصدرين (الإعداد الافتراضي أو قيمة صريحة من المستدعي، كما
        // في الاختبارات) عبر نفس بوابة التطبيع/التحقق — لا مسارٌ يثق بنطاق
        // أساسي غير مطبَّع.
        $baseDomain = $baseDomain === null
            ? self::configuredBaseDomain()
            : self::normalizeBaseDomain($baseDomain);

        if (trim($tenantSlug) === '') {
            throw new StorefrontBaseDomainMisconfiguredException('سلاج المستأجر فارغ — لا يمكن توليد نطاق متجر.');
        }

        try {
            $hostname = HostnameNormalizer::normalize($tenantSlug.'.'.$baseDomain);
        } catch (InvalidHostnameException $e) {
            throw new StorefrontBaseDomainMisconfiguredException(
                'تعذّر توليد نطاق متجر صالح لهذا المستأجر: '.$e->getMessage()
            );
        }

        if (! self::isUnderBaseDomain($hostname, $baseDomain)) {
            // خط دفاعٍ إضافي: سلاج قد يحتوي نقطة (لا ينبغي أن يجتاز `alpha_dash`
            // في `RegisterRequest` أصلاً) قد يُنتج مضيفاً بعدة شرائح لا شريحة
            // واحدة فوق النطاق الأساسي — يُرفض هنا صراحةً مهما كان مصدره.
            throw new StorefrontBaseDomainMisconfiguredException(
                'الاسم المولَّد لا يقع ضمن النطاق الأساسي المُهيَّأ لمتاجر Commerce المُدارة.'
            );
        }

        return $hostname;
    }

    /**
     * هل `$hostname` **شريحة واحدة بالضبط** فوق `$baseDomain` (كلاهما مطبَّع
     * مسبقاً)؟ حصراً — لا يقبل `$hostname === $baseDomain` (يجب أن يملك
     * المستأجر شريحته الخاصة)، ولا لاحقة/تشابه نصي بلا حد فاصل حقيقي
     * (`.`)، ولا أكثر من شريحة واحدة فوقه.
     *
     * دالة نقية بلا أي قراءة إعداد أو قاعدة بيانات — تُختبر مباشرة بسلاسل
     * هجوم مصطنعة (`store.awjdev.xyz.evil.com`، `evilstore.awjdev.xyz`، …).
     */
    public static function isUnderBaseDomain(string $hostname, string $baseDomain): bool
    {
        if ($hostname === '' || $baseDomain === '' || $hostname === $baseDomain) {
            return false;
        }

        $suffix = '.'.$baseDomain;
        if (! str_ends_with($hostname, $suffix)) {
            return false;
        }

        $prefix = substr($hostname, 0, -strlen($suffix));

        return $prefix !== '' && ! str_contains($prefix, '.');
    }
}
