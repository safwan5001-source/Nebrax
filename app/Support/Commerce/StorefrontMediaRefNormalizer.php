<?php

namespace App\Support\Commerce;

use App\Services\Commerce\StorefrontMediaTransform;
use InvalidArgumentException;

/**
 * CUST-HV V4a — تطبيع `MediaRef` (V0 §3.2): مرجعٌ إلى أصلٍ في مكتبة الوسائط +
 * معاملات إطاره **على الاستخدام لا على الأصل**. لا روابط ولا مسارات ولا أبعاد ولا
 * سطوع داخل الوثيقة أبداً — يشتقّها الخادم/المُصيِّر من المعرّف (§7.8).
 *
 * تطبيعٌ **متساهلٌ حتمي** (المسودة لا تُرفض): ما لا يصلح يُسقَط حقلاً حقلاً، وما
 * لا يحمل معرّفاً صالحاً يسقط كله (`null`). والقيم الافتراضية لا تُخزَّن
 * (`fit: cover`، تركيز 50/50، `rotate: 0`، `zoom: 1`) فتتطابق الوثائق المتكافئة
 * حرفياً. بوابة النشر (V2c) تفحص الوثيقة **المطبَّعة** هذه نفسها.
 *
 * ترتيب المفاتيح ثابت: mediaId · fit · focal · crop · rotate · alt · decorative.
 * توأماه: `…/presentation/media-ref.ts` في web وstorefront (بنفس الدالة والفيكستشر
 * `tests/Fixtures/presentation/media-ref.json`).
 *
 * الحقول المقبولة قائمة سماح؛ أي مفتاح آخر (`url`, `src`, `path`, `style`…) يُسقَط.
 */
final class StorefrontMediaRefNormalizer
{
    public const ALT_MAX = 150;

    private const UUID = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/';

    /** @return array<string,mixed>|null */
    public static function normalize(mixed $raw): ?array
    {
        if (! is_array($raw) || array_is_list($raw) && $raw !== []) {
            return null;
        }

        $id = $raw['mediaId'] ?? null;
        if (! is_string($id)) {
            return null;
        }
        $id = strtolower(self::phpTrim($id));
        if (preg_match(self::UUID, $id) !== 1) {
            return null;
        }

        $ref = ['mediaId' => $id];

        if (($raw['fit'] ?? null) === 'contain') {
            $ref['fit'] = 'contain';
        }

        $transform = self::transform($raw);
        if ($transform !== null) {
            if ($transform->focal !== null) {
                $ref['focal'] = $transform->focal;
            }
            if ($transform->crop !== null) {
                $crop = $transform->crop;
                if ($transform->zoom !== 1.0) {
                    $crop['zoom'] = $transform->zoom;
                }
                $ref['crop'] = $crop;
            }
            if ($transform->rotate !== 0) {
                $ref['rotate'] = $transform->rotate;
            }
        }

        $alt = self::alt($raw['alt'] ?? null);
        if ($alt !== []) {
            $ref['alt'] = $alt;
        }

        if (($raw['decorative'] ?? null) === true) {
            $ref['decorative'] = true;
        }

        return $ref;
    }

    /**
     * كل حقلٍ من حقول الإطار يُتحقَّق منه **بمفرده**: فسدُ القصّ لا يُسقط التدوير.
     */
    private static function transform(array $raw): ?StorefrontMediaTransform
    {
        $good = [];
        foreach (['focal', 'crop', 'rotate'] as $field) {
            if (! array_key_exists($field, $raw)) {
                continue;
            }
            try {
                StorefrontMediaTransform::fromInput([$field => $raw[$field]]);
                $good[$field] = $raw[$field];
            } catch (InvalidArgumentException) {
                // الحقل الفاسد وحده يسقط.
            }
        }

        try {
            return StorefrontMediaTransform::fromInput($good);
        } catch (InvalidArgumentException) {
            return null;
        }
    }

    /** @return array{ar?:string,en?:string} */
    private static function alt(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }

        $out = [];
        foreach (['ar', 'en'] as $locale) {
            $value = $raw[$locale] ?? null;
            if (! is_string($value)) {
                continue;
            }
            $value = self::phpTrim((string) preg_replace('/\p{Cc}+/u', ' ', $value));
            $value = mb_substr($value, 0, self::ALT_MAX);
            if ($value !== '') {
                $out[$locale] = $value;
            }
        }

        return $out;
    }

    private static function phpTrim(string $value): string
    {
        return trim($value, " \t\n\r\0\x0B");
    }
}
