<?php

namespace App\Support\Commerce;

/**
 * FLOWERS-H14 / ADR-25 — القيم المبدئية التي يقترحها ملف «الهدايا والورود» لبُعدَي المناسبة
 * والمُهدى إليه.
 *
 * قائمةٌ محدودة تملكها المنصة، **اقتراحٌ لا إلزام**: تُنشأ كقيم عادية يملكها التاجر فيعدّلها أو يعطّلها
 * أو يحذفها (ما لم تكن مُسنَدة). تدخل عبر `CommerceFacetService` نفسه، فلا مسار كتابة موازٍ ولا
 * تجاوز لقيود الاسم/الـslug/الحدود. ليست enum عالمياً: لا يقرأ المتجر هذه القائمة وقت التشغيل أبداً —
 * تُقرأ مرةً عند «إضافة القيم المبدئية» فقط.
 *
 * @phpstan-type StarterValue array{slug: string, name: string, name_en: string}
 * @phpstan-type StarterFacet array{key: string, system_key: string, name: string, name_en: string, values: list<StarterValue>}
 */
final class FlowersStarterCatalog
{
    /** @return list<StarterFacet> */
    public static function facets(): array
    {
        return [
            [
                'key' => 'occasion',
                'system_key' => 'occasion',
                'name' => 'المناسبة',
                'name_en' => 'Occasion',
                'values' => [
                    ['slug' => 'birthday', 'name' => 'عيد ميلاد', 'name_en' => 'Birthday'],
                    ['slug' => 'anniversary', 'name' => 'ذكرى سنوية', 'name_en' => 'Anniversary'],
                    ['slug' => 'wedding', 'name' => 'زفاف', 'name_en' => 'Wedding'],
                    ['slug' => 'graduation', 'name' => 'تخرّج', 'name_en' => 'Graduation'],
                    ['slug' => 'new-baby', 'name' => 'مولود جديد', 'name_en' => 'New baby'],
                    ['slug' => 'congratulations', 'name' => 'تهنئة', 'name_en' => 'Congratulations'],
                    ['slug' => 'thank-you', 'name' => 'شكر وامتنان', 'name_en' => 'Thank you'],
                    ['slug' => 'get-well', 'name' => 'سلامتك', 'name_en' => 'Get well'],
                    ['slug' => 'apology', 'name' => 'اعتذار', 'name_en' => 'Apology'],
                    ['slug' => 'love', 'name' => 'حب ورومانسية', 'name_en' => 'Love & romance'],
                    ['slug' => 'mothers-day', 'name' => 'عيد الأم', 'name_en' => "Mother's Day"],
                    ['slug' => 'ramadan-eid', 'name' => 'رمضان والعيد', 'name_en' => 'Ramadan & Eid'],
                ],
            ],
            [
                'key' => 'recipient',
                'system_key' => 'recipient',
                'name' => 'المُهدى إليه',
                'name_en' => 'Recipient',
                'values' => [
                    ['slug' => 'for-her', 'name' => 'لها', 'name_en' => 'For her'],
                    ['slug' => 'for-him', 'name' => 'له', 'name_en' => 'For him'],
                    ['slug' => 'mother', 'name' => 'الأم', 'name_en' => 'Mother'],
                    ['slug' => 'father', 'name' => 'الأب', 'name_en' => 'Father'],
                    ['slug' => 'wife', 'name' => 'الزوجة', 'name_en' => 'Wife'],
                    ['slug' => 'husband', 'name' => 'الزوج', 'name_en' => 'Husband'],
                    ['slug' => 'friend', 'name' => 'صديق أو صديقة', 'name_en' => 'Friend'],
                    ['slug' => 'colleague', 'name' => 'زميل أو زميلة', 'name_en' => 'Colleague'],
                    ['slug' => 'child', 'name' => 'طفل', 'name_en' => 'Child'],
                    ['slug' => 'newborn', 'name' => 'مولود', 'name_en' => 'Newborn'],
                ],
            ],
        ];
    }
}
