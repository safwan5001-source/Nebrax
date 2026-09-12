<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تطبيع/تحقّق hostname — مسارٌ مركزيٌّ وحيد (COM-7-P2A)
 * ═══════════════════════════════════════════════════════════════
 *  المصدر الوحيد لتطبيع أسماء النطاقات في المستودع — يستدعيه
 *  `StorefrontDomain::setHostnameAttribute()` (عند التخزين) و
 *  `ResolveStorefrontDomain` (عند حسم كل طلب من الـ Host الوارد) و
 *  `TenantHostnameResolver` (حسم نطاق مستأجر ERP الفرعي). **ممنوع**
 *  تكرار منطق تحليل hostname في أي وسيط/متحكّم آخر — انظر
 *  `AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md` §3/§7.
 *
 *  المخرَج نصٌّ منخفض الحالة بلا مخطط/بيانات اعتماد/مسار/استعلام/جزء/منفذ —
 *  hostname فقط، مطابقاً لما يُخزَّن في `storefront_domains.hostname`.
 *  مدخلٌ غير قابل للتطبيع يرمي `InvalidHostnameException` — لا تخمين، لا
 *  تصحيح صامت.
 *
 *  لا دعم لأسماء نطاقات دولية (IDN/punycode) في هذه المرحلة — تسميات ASCII
 *  فقط (a-z0-9 وشرطة داخلية)، محدود التوثيق كفجوة معروفة.
 */
final class HostnameNormalizer
{
    private const MAX_LENGTH = 253;

    private const MAX_LABEL_LENGTH = 63;

    public static function normalize(string $raw): string
    {
        $value = trim($raw);

        if ($value === '') {
            throw new InvalidHostnameException('اسم النطاق فارغ.');
        }

        // يزيل مخططاً إن أُرسل بالخطأ (Host الحقيقي القادم من طلب HTTP لا يحمل
        // مخططاً أصلاً؛ هذا احتياطٌ لمسارات إدخال يدوي مستقبلية تستدعي نفس
        // الدالة على نص قد يكون رابطاً كاملاً).
        if (str_contains($value, '://')) {
            $value = substr($value, strpos($value, '://') + 3);
        }

        // يقطع أي مسار/استعلام/جزء بعد أول '/', '?', '#'.
        $value = preg_split('/[\/?#]/', $value, 2)[0];

        if (str_contains($value, '@')) {
            throw new InvalidHostnameException('اسم النطاق يحتوي محارف غير صالحة.');
        }

        $value = self::stripPort($value);
        $value = mb_strtolower($value, 'UTF-8');
        $value = rtrim($value, '.');

        self::assertValid($value);

        return $value;
    }

    private static function stripPort(string $value): string
    {
        // حرفي IPv6 بين قوسين خارج نطاق هذا المطبّع — يُرفض لاحقاً في
        // assertValid لأنه ليس hostname نصياً صالحاً وفق تركيبنا المدعوم.
        if (str_starts_with($value, '[')) {
            return $value;
        }

        $lastColon = strrpos($value, ':');
        if ($lastColon === false) {
            return $value;
        }

        $port = substr($value, $lastColon + 1);
        if ($port !== '' && ctype_digit($port)) {
            return substr($value, 0, $lastColon);
        }

        return $value;
    }

    private static function assertValid(string $value): void
    {
        if ($value === '' || strlen($value) > self::MAX_LENGTH) {
            throw new InvalidHostnameException('اسم النطاق غير صالح.');
        }

        $labels = explode('.', $value);

        // لا نقبل host بلا نقطة إطلاقاً (مثل "localhost") كهوية متجرٍ حقيقي؛
        // بيئة التطوير المحلي مسارٌ منفصل تماماً (`ResolveStorefrontTenant`
        // القائم على شريحة الرابط)، لا يمرّ عبر هذا المطبّع أصلاً.
        if (count($labels) < 2) {
            throw new InvalidHostnameException('اسم النطاق غير صالح.');
        }

        foreach ($labels as $label) {
            if (
                $label === ''
                || strlen($label) > self::MAX_LABEL_LENGTH
                || ! preg_match('/\A[a-z0-9]([a-z0-9-]*[a-z0-9])?\z/', $label)
            ) {
                throw new InvalidHostnameException('اسم النطاق غير صالح.');
            }
        }
    }
}
