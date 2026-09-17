<?php

namespace App\Support\Dns;

/**
 * STORE-ADMIN-ADOPT-1B-3A — التنفيذ الإنتاجي الوحيد لـ`DnsTxtResolver`، عبر
 * `dns_get_record()` المدمجة في PHP (لا حزمة/مزوّد خارجي — القرار المعتمد في
 * التذكرة §20/§57). متزامن تماماً (V1): لا طابور، لا مهمة خلفية، مطابقاً
 * لبيئة الإنتاج الحالية (`QUEUE_CONNECTION=sync`).
 *
 * `dns_get_record()` تُعيد `false` عند فشل تشغيلي حقيقي (تعذّر الاتصال
 * بالمحلّل مثلاً) — يُترجَم هنا إلى `DnsOperationalException` فوراً، لا نتيجة
 * تحقّق سلبية. تُعيد مصفوفة (فارغة أو مملوءة) عند نجاح الاستعلام نفسه بصرف
 * النظر عن وجود سجلّ TXT مطلوب من عدمه — تلك مسؤولية طبقة المقارنة في
 * `StorefrontDomainVerificationService`, لا هذا الصنف.
 *
 * شكل عنصر TXT في PHP قد يحمل `txt` (النص الكامل المُدمَج) أو `entries`
 * (أجزاء 255-بايت الخام قبل الدمج، لسجلّات تتجاوز طول جزء واحد) — نُفضِّل
 * `txt` حين تكون سلسلة نصية فعلية، ونُسقِط `entries` معاً fallback فقط.
 */
final class NativeDnsTxtResolver implements DnsTxtResolver
{
    public function lookupTxt(string $recordName): array
    {
        // @ تقصدي: dns_get_record ترفع E_WARNING عند فشل الاستعلام (لا نريد
        // أن تسرّب تفاصيل المحلّل/الشبكة كتحذير PHP خام في السجلّات العامة) —
        // الإشارة الفعلية للفشل هي قيمة الإرجاع `false` نفسها، نتعامل معها
        // صراحة أدناه بصرف النظر عن التحذير.
        $records = @dns_get_record($recordName, DNS_TXT);

        if ($records === false) {
            throw new DnsOperationalException('تعذّر الاستعلام عن سجلات DNS TXT لهذا النطاق.');
        }

        $values = [];
        foreach ($records as $record) {
            if (! is_array($record)) {
                continue;
            }

            if (isset($record['txt']) && is_string($record['txt'])) {
                $values[] = $record['txt'];

                continue;
            }

            if (isset($record['entries']) && is_array($record['entries'])) {
                $joined = implode('', array_filter($record['entries'], 'is_string'));
                if ($joined !== '') {
                    $values[] = $joined;
                }
            }
        }

        return $values;
    }
}
