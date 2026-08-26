<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مطابقة ترويسات ملفات الاستيراد — تطبيعٌ ومطابقةٌ مشتركان
 * ═══════════════════════════════════════════════════════════════
 *  استُخرجت من `ProductImportFields` حين احتاجها مسارٌ ثانٍ (الأرصدة
 *  الافتتاحية للمخزون). التطبيع العربي هنا دقيقٌ ومكلفُ التكرار: توحيد
 *  الألف والتاء المربوطة والياء وإسقاط التشكيل. نسخةٌ ثانية منه كانت
 *  ستنحرف عن الأولى بأول تعديل، فيصير عمودٌ يُطابَق في مسارٍ ولا يُطابَق
 *  في الآخر بلا سبب ظاهر للمستخدم.
 *
 *  الكتالوجات تبقى مستقلّة تماماً — لكلٍّ حقولُه ومرادفاته — ولا يشترك
 *  المساران إلا في **كيفية** المطابقة.
 */
class ImportHeaderMatcher
{
    /**
     * يطبّع اسم عمود من ملف المستخدم إلى مفتاح مقارنة: حروف وأرقام فقط،
     * صغيرة، بلا مسافات ولا شرطات ولا تشكيل.
     */
    public static function normalize(string $header): string
    {
        $value = trim($header, "\xEF\xBB\xBF \t\n\r\0\x0B");
        $value = mb_strtolower($value, 'UTF-8');
        // توحيد الألف والهاء/التاء المربوطة والياء كي يطابق «الفئة» و«الفئه».
        $value = strtr($value, [
            'أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا',
            'ة' => 'ه', 'ى' => 'ي', 'ؤ' => 'و', 'ئ' => 'ي',
        ]);
        $value = preg_replace('/[\x{0610}-\x{061A}\x{064B}-\x{065F}\x{0670}]/u', '', $value) ?? $value;
        $value = preg_replace('/[^\p{L}\p{N}]+/u', '', $value) ?? $value;

        return $value;
    }

    /**
     * يقترح المفتاح المطابق لاسم عمود، أو `null` إذا لم يكن التطابق واضحاً.
     *
     * لا تخمين ضبابي: التطابق على المفتاح المطبَّع أو على مرادف معلن فقط.
     * عمودٌ غامض يبقى بلا اقتراح ليقرّره المستخدم — اقتراحٌ خاطئ أسوأ من
     * لا اقتراح.
     *
     * @param  array<string, array<int, string>>  $aliasesByKey  مفتاح الحقل → مرادفاته
     */
    public static function suggest(string $header, array $aliasesByKey): ?string
    {
        $needle = self::normalize($header);
        if ($needle === '') {
            return null;
        }

        foreach ($aliasesByKey as $key => $aliases) {
            if ($needle === self::normalize($key)) {
                return $key;
            }
            foreach ($aliases as $alias) {
                if ($needle === self::normalize($alias)) {
                    return $key;
                }
            }
        }

        return null;
    }

    /**
     * مطابقة تلقائية لكل أعمدة الملف. العمود الذي يكرّر حقلاً سبق ربطه يبقى
     * غير مربوط — عمودان على حقلٍ واحد غموضٌ يقرّره المستخدم لا التخمين.
     *
     * @param  array<int, string>  $headers
     * @param  array<string, array<int, string>>  $aliasesByKey
     * @return array<int, string|null>  فهرس العمود → مفتاح الحقل
     */
    public static function autoMap(array $headers, array $aliasesByKey): array
    {
        $mapping = [];
        $taken = [];

        foreach (array_values($headers) as $index => $header) {
            $key = self::suggest((string) $header, $aliasesByKey);
            if ($key !== null && ! isset($taken[$key])) {
                $mapping[$index] = $key;
                $taken[$key] = true;
                continue;
            }
            $mapping[$index] = null;
        }

        return $mapping;
    }
}
