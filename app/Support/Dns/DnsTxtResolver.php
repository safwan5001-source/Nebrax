<?php

namespace App\Support\Dns;

/**
 * STORE-ADMIN-ADOPT-1B-3A — سلاحف صغير (seam) بين `StorefrontDomainVerificationService`
 * وتنفيذ استعلام DNS الفعلي. الإنتاج يستعمل `NativeDnsTxtResolver`
 * (`dns_get_record()` من PHP نفسه — لا مزوّد خارجي مدفوع، القرار المعتمد
 * صراحة في التذكرة). الاختبارات تربط تنفيذاً وهمياً حتمياً (`FakeDnsTxtResolver`
 * في ملفات الاختبار) عبر الحاوية — لا استعلام DNS حقيقي على الإنترنت داخل CI.
 */
interface DnsTxtResolver
{
    /**
     * يعيد كل قيم سجلّات TXT المسجَّلة على `$recordName` (نصّاً مفكوكاً
     * بلا علامات اقتباس/تجزئة 255-بايت — التطبيع الحرفي مسؤولية المنفِّذ).
     * قائمة فارغة تعني «لا سجلات TXT إطلاقاً» — نجاحٌ تشغيلي، لا فشل.
     *
     * @return list<string>
     *
     * @throws DnsOperationalException فشل تشغيلي (محلّل/شبكة/وقت تشغيل) — لا
     *                                 يعني هذا أن المالك لا يملك النطاق، بل
     *                                 أن الاستعلام نفسه لم يكتمل.
     */
    public function lookupTxt(string $recordName): array;
}
