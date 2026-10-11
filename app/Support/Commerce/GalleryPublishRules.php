<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V8d — قواعد نشر قسم المعرض (V0 §13.2). السلطة هنا؛ المحرّر يعرض نتيجةً استشاريةً بتوأم TS
 * (`galleryPublishIssues` في `gallery-content.ts`)، والتكافؤ محروس بفيكستشر مشترك.
 *
 *  1. صورتان على الأقل (V0: 2–24) لكل قسمٍ ظاهر — صورةٌ واحدة ليست معرضاً. المسودة تقبل ما دون ذلك.
 *  2. لا حكم تباين: لا نصٌّ يُرسم فوق الصور (التعليق تحتها على سطح القسم). النص البديل لكل لغة وملكية الوسائط
 *     تحرسهما بوابة الوسائط العامة (`StorefrontMediaPublishGate`) التي تمسح كل `mediaId` في الوثيقة.
 */
final class GalleryPublishRules
{
    /**
     * @param  array<string,mixed>  $normalized
     * @return array<string, array{code:string,message:string}>
     */
    public static function errors(array $normalized): array
    {
        $sections = $normalized['homepage']['sections'] ?? null;
        if (! is_array($sections)) {
            return [];
        }

        $errors = [];
        foreach (array_values($sections) as $i => $section) {
            if (! is_array($section) || ($section['type'] ?? null) !== 'gallery' || ($section['visible'] ?? false) !== true) {
                continue; // قسمٌ مخفي لا يُعرض فلا يحجب النشر.
            }
            $images = is_array($section['content']['images'] ?? null) ? $section['content']['images'] : [];
            if (count($images) < StorefrontGalleryNormalizer::MIN_IMAGES_TO_PUBLISH) {
                $errors["homepage.sections[{$i}].content.images"] = [
                    'code' => 'gallery_images_min',
                    'message' => 'يتطلب قسم المعرض صورتين على الأقل قبل النشر.',
                ];
            }
        }

        return $errors;
    }
}
