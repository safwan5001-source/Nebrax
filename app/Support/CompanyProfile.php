<?php

namespace App\Support;

use App\Models\Tenant;

/**
 * عقد ملف المؤسسة المعروض للقشرة والمستندات.
 *
 * بيانات الهوية القانونية الأساسية تعيش على المستأجر، بينما بيانات الاتصال
 * والعنوان الوطني تعيش في مجموعة إعدادات company. جمعهما هنا يمنع انحراف
 * استجابة /me عن استجابة حفظ ملف المؤسسة.
 */
class CompanyProfile
{
    /** أعمدة المستأجر التي يملكها ملف المؤسسة. */
    public const TENANT_FIELDS = [
        'name',
        'vat_number',
        'cr_number',
        'currency',
        'country',
    ];

    /** مفاتيح company القابلة للحفظ والعرض في المستندات. */
    public const SETTINGS_FIELDS = [
        'logo',
        'phone',
        'mobile',
        'building_no',
        'street',
        'additional_no',
        'district',
        'city',
        'postal_code',
        'short_address',
    ];

    /** يصنع العقد الموحّد الذي تستهلكه القشرة وقوالب المستندات. */
    public static function payload(?Tenant $tenant): ?array
    {
        if (! $tenant) {
            return null;
        }

        $company = Settings::group('company', $tenant);

        return [
            'name'           => $tenant->name,
            'account_number' => $tenant->account_number,
            'support_number' => $tenant->support_number,
            'vat_number'     => $tenant->vat_number,
            'cr_number'     => $tenant->cr_number,
            'currency'      => $tenant->currency,
            'country'       => $tenant->country,
            // CUST-H1-5 — عمود `tenants.timezone` قائمٌ منذ الترحيل الأول
            // (افتراضه 'Asia/Riyadh')، ومصدر المنطقة الزمنية المعتمَد فعلياً في
            // منع خسائر نقاط البيع (`PosLpDigestService`/`PosExceptionDetectionService`
            // — "لا مصدر ثانٍ موازٍ"). لم يكن مكشوفاً لأي عميل واجهة قبل هذا؛
            // هذا الحقل يعرضه للقراءة فقط عبر عقد `/me` القائم أصلاً — لا كتابة
            // جديدة هنا (`TENANT_FIELDS` لا يتضمّنه عمداً، فتعديله خارج نطاق
            // هذا الأفق). يُستهلَك من جدولة نسخ عرض المتجر (CUST-H1-5) كمصدر
            // التوقيت الوحيد الموثوق — لا توقيت المتصفح ولا "آسيا/الرياض" ثابتاً.
            'timezone'      => $tenant->timezone,
            'logo'          => $company['logo'],
            'phone'         => $company['phone'],
            'mobile'        => $company['mobile'],
            'building_no'   => $company['building_no'],
            'street'        => $company['street'],
            'additional_no' => $company['additional_no'],
            'district'      => $company['district'],
            'city'          => $company['city'],
            'postal_code'   => $company['postal_code'],
            'short_address' => $company['short_address'],
        ];
    }
}
