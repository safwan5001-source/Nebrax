<?php

namespace App\Http\Resources;

use App\Models\StorefrontMedia;
use App\Services\Commerce\StorefrontMediaService;
use App\Services\Commerce\StorefrontMediaVariantGenerator;

/**
 * CUST-HV V2a — تمثيل أصل وسائط لمساحة العمل. قائمة سماح ضيقة بالبناء:
 * **لا** `storage_key` ولا مسار/قرص/دلو ولا `sha256` ولا `region_luminance`
 * (V0 §7.3 — «لا استجابة تحوي قرصاً أو دلواً أو مفتاحاً أو مساراً داخلياً»).
 * الروابط المعروضة موقَّعة قصيرة الأجل ويُعاد إصدارها مع كل قراءة.
 */
final class StorefrontMediaResource
{
    /**
     * @param  int|null  $usageCount  عدد الحاويات (نسخ/رأس) المشيرة إليه، إن حُسب.
     * @return array<string, mixed>
     */
    public static function workspace(StorefrontMedia $media, StorefrontMediaService $service, ?int $usageCount = null): array
    {
        $variants = array_map(static fn (array $v): array => [
            'kind' => $v['kind'],
            'width' => $v['width'],
            'height' => $v['height'],
            'format' => $v['format'],
        ], $media->variantList());

        return [
            'id' => $media->id,
            'name' => $media->original_name,
            'mime' => $media->mime,
            'size' => $media->size,
            'width' => $media->width,
            'height' => $media->height,
            'alt_ar' => $media->alt_ar,
            'alt_en' => $media->alt_en,
            'variants_state' => $media->variants_state,
            'variants_error' => $media->variants_state === StorefrontMedia::VARIANTS_FAILED ? $media->variants_error : null,
            'variants' => $variants,
            'thumbnail_url' => self::firstAvailable($media, $service, [
                StorefrontMediaVariantGenerator::fileName(StorefrontMediaVariantGenerator::KIND_THUMB, 320, StorefrontMediaVariantGenerator::FORMAT_WEBP),
                StorefrontMediaVariantGenerator::fileName(StorefrontMediaVariantGenerator::KIND_THUMB, 320, StorefrontMediaVariantGenerator::FORMAT_JPG),
            ]),
            'preview_url' => self::previewUrl($media, $service),
            'usage_count' => $usageCount,
            'created_at' => $media->created_at?->toIso8601String(),
        ];
    }

    /** @param list<string> $files */
    private static function firstAvailable(StorefrontMedia $media, StorefrontMediaService $service, array $files): ?string
    {
        foreach ($files as $file) {
            $url = $service->signedUrl($media, $file);
            if ($url !== null) {
                return $url;
            }
        }

        return null;
    }

    /** أكبر عرضٍ ≤ 1280 بصيغة WebP (مع JPEG احتياطي) — معاينة مساحة العمل لا النشر. */
    private static function previewUrl(StorefrontMedia $media, StorefrontMediaService $service): ?string
    {
        $best = null;
        foreach ($media->variantList() as $variant) {
            if ($variant['kind'] !== StorefrontMediaVariantGenerator::KIND_WIDTH || $variant['width'] > 1280) {
                continue;
            }
            if ($best === null || $variant['width'] > $best) {
                $best = $variant['width'];
            }
        }
        if ($best === null) {
            return null;
        }

        return self::firstAvailable($media, $service, [
            StorefrontMediaVariantGenerator::fileName(StorefrontMediaVariantGenerator::KIND_WIDTH, $best, StorefrontMediaVariantGenerator::FORMAT_WEBP),
            StorefrontMediaVariantGenerator::fileName(StorefrontMediaVariantGenerator::KIND_WIDTH, $best, StorefrontMediaVariantGenerator::FORMAT_JPG),
        ]);
    }
}
