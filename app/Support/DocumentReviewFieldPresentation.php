<?php

namespace App\Support;

/**
 * تصفية عرض حقول المراجعة حسب نوع المستند — عقد الاستخراج والتطبيع
 * (`DocumentExtractionNormalizer`) يبقى واحداً مشتركاً لكل الأنواع؛ هذا الصنف
 * فقط يقرر أيّ حقولٍ منه ذات معنى للعرض لنوع بعينه، دون تغيير البيانات أو
 * توليد حقل جديد. النوع غير المُدرَج هنا يعرض كل الحقول كما هو السلوك الحالي.
 */
final class DocumentReviewFieldPresentation
{
    /** @var array<string, list<string>> */
    private const HEADER_FIELDS_BY_TYPE = [
        // سند تسليم عام (ADR-009): لا سعر ولا ضريبة ولا إجمالي في نطاقه. رقم أمر
        // الشراء غير معروض حالياً أيضاً — قرار منتج صريح، لا نقص تقني.
        'delivery_note' => [
            'issuer_name', 'issuer_tax_number', 'recipient_name', 'recipient_tax_number',
            'document_number', 'document_date', 'external_reference',
        ],
    ];

    /** @var array<string, list<string>> */
    private const LINE_FIELDS_BY_TYPE = [
        'delivery_note' => ['description', 'sku', 'barcode', 'unit', 'quantity'],
    ];

    /** @return list<string>|null قائمة صريحة، أو null لعرض كل الحقول (السلوك الحالي) */
    public static function visibleHeaderFields(string $documentType): ?array
    {
        return self::HEADER_FIELDS_BY_TYPE[$documentType] ?? null;
    }

    /** @return list<string>|null */
    public static function visibleLineFields(string $documentType): ?array
    {
        return self::LINE_FIELDS_BY_TYPE[$documentType] ?? null;
    }
}
