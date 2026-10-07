<?php

namespace App\Services\Commerce;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use InvalidArgumentException;

/**
 * CUST-HV V4a — يحوّل كل `MediaRef` في الوثيقة **المنشورة** إلى ما يلزم العرضَ فقط:
 * قائمة مصادر (عرض/ارتفاع/صيغة/مسار **بروكسي** نسبي) وبدائل لكل لغة (V0 §7.8).
 * تُعاد بمفتاح **مسار المرجع داخل الوثيقة** (`branding.logoMedia`) فلا يحتاج
 * المُصيِّر إلى حساب مفاتيح التحويل (لا توأم TS لتجزئة `transformKey`) ولا إلى
 * معرفة أي موضع بعينه — يعمل لكل حقلٍ تضيفه شرائح V5–V9.
 *
 * **استثناء مقصود (V6b-3):** مرجعٌ تحت `design.background` (صورة خلفية قسم) يحمل `contrast` — حدّا قنوات
 * مشفّرة (min/max، موسَّعان بهامش الترميز) تُطابق ما أُثبت عند النشر — لأن المتجر العام يختار منهما لون
 * النص التلقائي بالخوارزمية ذاتها. هي أرقامٌ مشتقّة من صورةٍ عامة أصلاً (لا سرّ فيها) ولا تخرج لغير هذا الموضع.
 *
 * **ما لا يخرج أبداً:** مسار/دلو/مفتاح تخزين، sha256، اسم الملف الأصلي، متوسط السطوع/اللون الغالب،
 * رابط الأصل المضيفي `/store/v1/media/customizer/...` (المتصفح لا يبلغه؛ البروكسي
 * الوحيد: `/api/storefront/media/customizer/{id}/{file}`، AMEND-1).
 *
 * مرجعٌ لا يمكن حلّه (أصل محذوف/غير جاهز، مشتقّ غير جاهز) **يُحذف من الخريطة**
 * فيسقط المُصيِّر إلى الحقل القديم/اللاشيء — بوابة النشر تمنع هذا أصلاً، فهو
 * دفاعٌ لا مسارٌ متوقَّع. يعمل ضمن مستأجر الطلب العام (`TenantContext`).
 */
final class StorefrontPublishedMediaResolver
{
    public const PROXY_PREFIX = '/api/storefront/media/customizer/';

    public function __construct(private readonly StorefrontMediaReferenceScanner $scanner) {}

    /**
     * @param  array<string,mixed>  $published
     * @return array<string, array{
     *   width:int, height:int, decorative:bool,
     *   alt:array{ar:string|null,en:string|null},
     *   sources:list<array{kind:string,width:int,height:int,format:string,src:string}>,
     *   contrast?:array{min:list<int>,max:list<int>}
     * }>
     */
    public function resolve(array $published): array
    {
        $refs = $this->scanner->extractRefs($published);
        if ($refs === []) {
            return [];
        }

        $assets = StorefrontMedia::query()
            ->whereIn('id', array_values(array_unique(array_column(array_column($refs, 'ref'), 'mediaId'))))
            ->where('state', StorefrontMedia::STATE_ACTIVE)
            ->where('variants_state', StorefrontMedia::VARIANTS_READY)
            ->get()
            ->keyBy('id');

        $resolved = [];
        foreach ($refs as ['path' => $path, 'ref' => $ref]) {
            $asset = $assets->get($ref['mediaId']);
            if ($asset === null) {
                continue;
            }

            $entry = $this->entry($asset, $ref);
            if ($entry !== null) {
                // V6b-3 — حدود التباين لصور خلفيات الأقسام فقط؛ غيابها (دليلٌ غير صالح) = «غير مُثبَت» فلا لون نص تلقائي.
                if (str_contains($path, '.design.background.')) {
                    $bounds = app(StorefrontMediaContrastEvidence::class)->boundsFor($ref);
                    if ($bounds !== null) {
                        $entry['contrast'] = $bounds;
                    }
                }
                $resolved[$path] = $entry;
            }
        }

        return $resolved;
    }

    /**
     * @param  array<string,mixed>  $ref
     * @return array<string,mixed>|null
     */
    private function entry(StorefrontMedia $asset, array $ref): ?array
    {
        try {
            $transform = StorefrontMediaTransform::fromInput([
                'crop' => $ref['crop'] ?? null,
                'rotate' => $ref['rotate'] ?? 0,
                'focal' => $ref['focal'] ?? null,
                'fit' => $ref['fit'] ?? 'cover',
            ]);
        } catch (InvalidArgumentException) {
            return null;
        }

        $sources = $transform->isDefault()
            ? $this->baseSources($asset)
            : $this->derivativeSources($asset, $transform);
        if ($sources === []) {
            return null;
        }

        $widths = array_values(array_filter($sources, static fn (array $s): bool => $s['kind'] === 'w'));
        $largest = $widths === [] ? $sources[0] : $widths[array_key_last($widths)];
        $alt = is_array($ref['alt'] ?? null) ? $ref['alt'] : [];

        return [
            'width' => $transform->isDefault() ? (int) $asset->width : $largest['width'],
            'height' => $transform->isDefault() ? (int) $asset->height : $largest['height'],
            'decorative' => ($ref['decorative'] ?? false) === true,
            'alt' => [
                'ar' => $this->firstText($alt['ar'] ?? null, $asset->alt_ar),
                'en' => $this->firstText($alt['en'] ?? null, $asset->alt_en),
            ],
            'sources' => $sources,
        ];
    }

    /** @return list<array{kind:string,width:int,height:int,format:string,src:string}> */
    private function baseSources(StorefrontMedia $asset): array
    {
        $sources = [];
        foreach ($asset->variantList() as $variant) {
            $sources[] = [
                'kind' => (string) $variant['kind'],
                'width' => (int) $variant['width'],
                'height' => (int) $variant['height'],
                'format' => (string) $variant['format'],
                'src' => self::PROXY_PREFIX.$asset->id.'/'.$variant['file'],
            ];
        }

        return $this->ordered($sources);
    }

    /** @return list<array{kind:string,width:int,height:int,format:string,src:string}> */
    private function derivativeSources(StorefrontMedia $asset, StorefrontMediaTransform $transform): array
    {
        $rows = StorefrontMediaDerivative::query()
            ->where('media_id', $asset->id)
            ->where('usage_key', $transform->usageKey($asset->id))
            ->where('state', StorefrontMediaDerivative::STATE_READY)
            ->orderBy('width')
            ->get();

        // Never a partial set: every nominal width × format must be ready (the
        // Publish gate guarantees it; this is the defensive twin).
        if ($rows->count() < count(StorefrontMediaDerivativeService::FORMATS) * count((array) config('storefront_media.derivative_widths'))) {
            return [];
        }

        $sources = [];
        $seen = [];
        foreach ($rows as $row) {
            // Widths clamped to the frame render identically: one entry per real size.
            $key = $row->rendered_width.'.'.$row->format;
            if ($row->rendered_width === null || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $sources[] = [
                'kind' => 'w',
                'width' => (int) $row->rendered_width,
                'height' => (int) $row->rendered_height,
                'format' => $row->format,
                'src' => self::PROXY_PREFIX.$row->transform_key.'/'.StorefrontMediaVariantGenerator::fileName(StorefrontMediaVariantGenerator::KIND_WIDTH, $row->width, $row->format),
            ];
        }

        return $this->ordered($sources);
    }

    /**
     * @param  list<array{kind:string,width:int,height:int,format:string,src:string}>  $sources
     * @return list<array{kind:string,width:int,height:int,format:string,src:string}>
     */
    private function ordered(array $sources): array
    {
        usort($sources, static fn (array $a, array $b): int => [$a['kind'], $a['width'], $a['format']] <=> [$b['kind'], $b['width'], $b['format']]);

        return $sources;
    }

    private function firstText(mixed $override, mixed $library): ?string
    {
        foreach ([$override, $library] as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }
        }

        return null;
    }
}
