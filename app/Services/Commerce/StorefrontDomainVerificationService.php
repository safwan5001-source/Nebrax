<?php

namespace App\Services\Commerce;

use App\Models\StorefrontDomain;
use App\Support\Dns\DnsOperationalException;
use App\Support\Dns\DnsTxtResolver;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  STORE-ADMIN-ADOPT-1B-3A — تحقّق ملكية DNS TXT لنطاق مخصَّص
 * ═══════════════════════════════════════════════════════════════
 *
 * أصغر خدمة قابلة لإعادة الاستعمال بمسؤولية واحدة: اشتقاق اسم/قيمة سجلّ TXT
 * المتوقَّعين من `verification_token` المخزَّن، استعلام DNS الحقيقي عبر
 * `DnsTxtResolver` (سلاح قابل للتبديل — الإنتاج `NativeDnsTxtResolver`،
 * الاختبار تنفيذ وهمي حتمي)، ومقارنة القيم المُعادة بالقيمة المتوقَّعة
 * حصراً.
 *
 * **لا علاقة له بـ Tenant/Storefront/Domain ownership** — المستدعي
 * (`CommerceWorkspaceStorefrontsService::verifyCustomDomainForCurrentTenant()`)
 * يحلّ الملكية بالكامل *قبل* استدعاء `verify()`؛ هذا الصنف يثق بأن
 * `StorefrontDomain` المُمرَّر مملوكٌ فعلاً وصالحٌ للتحقّق.
 *
 * ═══════════════════════════════════════════════════════════════
 *  عقد سجلّ TXT (القرار §18 — ثابت، موثَّق هنا حصراً)
 * ═══════════════════════════════════════════════════════════════
 *  Record type:  TXT
 *  Record name:  `_awj-verification.<custom-hostname>`
 *  Record value: `awj-domain-verification=<token>`
 *
 *  مثال لنطاق `shop.example.com` بترميز `abcd1234…`:
 *    _awj-verification.shop.example.com.  TXT  "awj-domain-verification=abcd1234…"
 *
 *  اسم السجلّ مُشتَقٌّ **حتمياً** من hostname المطبَّع (لا اختيار مستخدم)،
 *  والقيمة تُشتَقّ من `verification_token` المولَّد خادمياً وحده — العميل لا
 *  يستطيع التأثير في أيٍّ منهما، ولا في نتيجة التحقّق (لا يُقرأ token من
 *  الطلب إطلاقاً، فقط من الصفّ المخزَّن).
 */
final class StorefrontDomainVerificationService
{
    private const RECORD_PREFIX = '_awj-verification';

    private const VALUE_PREFIX = 'awj-domain-verification=';

    /** عدد بايتات العشوائية قبل الترميز السداسي عشري — 24 بايت = 192 بت، أعلى من أي هجوم تخمين عملي. */
    private const TOKEN_ENTROPY_BYTES = 24;

    public function __construct(private readonly DnsTxtResolver $resolver) {}

    public static function recordNameFor(string $hostname): string
    {
        return self::RECORD_PREFIX.'.'.$hostname;
    }

    public static function expectedValueFor(string $token): string
    {
        return self::VALUE_PREFIX.$token;
    }

    /**
     * توليد challenge عشوائي عالي الإنتروبيا — عشوائية آمنة تشفيرياً
     * (`random_bytes()`، القرار §16)، لا مبني على hostname/tenant_id/
     * storefront_id/domain id/طابع زمني/عدّاد متوقَّع. يُستدعى **مرة واحدة
     * فقط** عند إنشاء النطاق — لا واجهة إعادة توليد في 1B-3A (القرار §27).
     */
    public static function generateToken(): string
    {
        return bin2hex(random_bytes(self::TOKEN_ENTROPY_BYTES));
    }

    /**
     * يشغّل تحقّق DNS TXT فعلياً لنطاق `custom` مملوكٍ فعلاً (تحقّقه مسؤولية
     * المستدعي). يقارن **بالقيمة الكاملة المطابقة تماماً**
     * (`hash_equals` — زمن ثابت، لا حاجة أمنية هنا لأن القيمة ليست سرّية بعد
     * نشرها في DNS العام، لكنه نمطٌ متّسق آمن افتراضياً) — سجلّ TXT آخر غير
     * ذي صلة، أو قيمة بادئة صحيحة برمز خاطئ، لا يحقّقان النجاح أبداً.
     *
     * @throws RuntimeException النطاق ليس `custom` أو بلا `verification_token`
     *                           مخزَّن — خطأ استدعاء داخلي، لا حالة مستخدم عادية
     *                           (المستدعي يتحقّق من `type` قبل الوصول هنا).
     */
    public function verify(StorefrontDomain $domain): DomainVerificationResult
    {
        if ($domain->type !== StorefrontDomain::TYPE_CUSTOM || $domain->verification_token === null) {
            throw new RuntimeException('هذا النطاق لا يملك مسار تحقّق DNS TXT صالحاً.');
        }

        $recordName = self::recordNameFor($domain->hostname);
        $expectedValue = self::expectedValueFor($domain->verification_token);

        try {
            $records = $this->resolver->lookupTxt($recordName);
        } catch (DnsOperationalException) {
            return DomainVerificationResult::operationalFailure();
        }

        foreach ($records as $value) {
            if (is_string($value) && hash_equals($expectedValue, $value)) {
                return DomainVerificationResult::success();
            }
        }

        return DomainVerificationResult::mismatch();
    }
}
