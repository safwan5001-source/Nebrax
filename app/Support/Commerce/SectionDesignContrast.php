<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V5d — بوّابة تباين تصميم الأقسام عند النشر (V0 §4.5.5–6).
 *
 * **السلطة:** المحرّر يحسب نتيجةً استشاريةً حيّة بتوأم TS من هذه الدالّة نفسها
 * (`effectiveText` / `sectionContrastIssues` في `section-design-resolve.ts`)، ويعيد
 * PHP الحساب عند النشر **بالخوارزمية ذاتها** (`ContrastEngine`) فيرفض 422 — فلا
 * يمكن تجاوز المحرّر. تكافؤ الاثنين محروس بملف حالات مشترك.
 *
 * ما يُقاس هو **ما سيُرسم فعلاً**: المقدّمة الفعلية للقسم (صريحة، أو تلقائية فوق
 * خلفية — الأبيض/الأسود الصافي الأفضل إثباتاً على كامل مدى الخلفية)، مقابل مدى
 * خلفية القسم (صلبة أو تدرّج بمداه كلّه، لا طرفاه). قسمٌ بلا خلفية يُحكَم على ألوان
 * نصّه الصريحة مقابل خلفية الصفحة. «غير مُثبَت» = «غير مطابق».
 */
final class SectionDesignContrast
{
    /** لون خلفية الصفحة اليوم (`--store-background`) — ما خلف قسمٍ بلا خلفية. */
    public const PAGE_BACKGROUND = '#f8f9fa';

    /** رموز اليوم الثابتة لدورٍ لم يضبطه التاجر (توأم `ROLE_FALLBACK_HEX`). */
    public const ROLE_FALLBACK = [
        'surface' => '#ffffff',
        'surfaceAlt' => '#f3f4f6',
        'text' => '#111827',
        'heading' => '#111827',
        'border' => '#e5e7eb',
        'overlay' => '#000000',
    ];

    /** كما `mixHex` في TS: استكمال خطّي ثم تقريب نصف-للأعلى لكل قناة. */
    public static function mixHex(string $hex, string $other, float $amount): string
    {
        $a = ContrastEngine::parseHex($hex);
        $b = ContrastEngine::parseHex($other);
        if ($a === null || $b === null) {
            return $hex;
        }
        $channel = static fn (float $v): string => str_pad(dechex(max(0, min(255, (int) floor($v + 0.5)))), 2, '0', STR_PAD_LEFT);

        return '#'.$channel($a[0] + ($b[0] - $a[0]) * $amount)
            .$channel($a[1] + ($b[1] - $a[1]) * $amount)
            .$channel($a[2] + ($b[2] - $a[2]) * $amount);
    }

    public static function suggestAccent(string $brand): string
    {
        return self::mixHex($brand, '#ffffff', 0.35);
    }

    /**
     * @param  array<string,mixed>  $config  primaryColor / accentColor / palette
     */
    public static function roleHex(string $role, array $config): string
    {
        $brand = is_string($config['primaryColor'] ?? null) ? $config['primaryColor'] : '#12372a';
        $palette = is_array($config['palette'] ?? null) ? $config['palette'] : [];
        $accent = $config['accentColor'] ?? null;

        return match ($role) {
            'brand' => $brand,
            'accent' => is_string($accent) && ContrastEngine::parseHex($accent) !== null ? $accent : self::suggestAccent($brand),
            'link' => is_string($palette['link'] ?? null) ? $palette['link'] : $brand,
            default => is_string($palette[$role] ?? null) ? $palette[$role] : (self::ROLE_FALLBACK[$role] ?? $brand),
        };
    }

    /** @param  array<string,mixed>  $config */
    private static function colour(mixed $ref, array $config): ?string
    {
        if (! is_array($ref)) {
            return null;
        }
        if (isset($ref['role']) && is_string($ref['role'])) {
            return self::roleHex($ref['role'], $config);
        }

        return is_string($ref['hex'] ?? null) ? $ref['hex'] : null;
    }

    /**
     * @param  array<string,mixed>  $design
     * @param  array<string,mixed>  $config
     * @return array{min:float,max:float}|null
     */
    private static function backgroundInterval(array $design, array $config): ?array
    {
        $bg = $design['background'] ?? null;
        if (! is_array($bg)) {
            return null;
        }
        if (($bg['kind'] ?? null) === 'solid') {
            $rgb = ContrastEngine::parseHex((string) self::colour($bg['color'] ?? null, $config));

            return $rgb === null ? null : ContrastEngine::solidInterval($rgb);
        }
        if (($bg['kind'] ?? null) === 'gradient') {
            $a = ContrastEngine::parseHex((string) self::colour($bg['from'] ?? null, $config));
            $b = ContrastEngine::parseHex((string) self::colour($bg['to'] ?? null, $config));

            return $a === null || $b === null ? null : ContrastEngine::gradientInterval($a, $b);
        }

        return null;
    }

    /**
     * ما سيُرسم فعلاً (توأم `effectiveText`).
     *
     * @param  array<string,mixed>  $design
     * @param  array<string,mixed>  $config
     * @return array{body:?string,heading:?string,link:?string,background:?array{min:float,max:float},judged:?array{min:float,max:float}}
     */
    public static function effectiveText(array $design, array $config): array
    {
        $background = self::backgroundInterval($design, $config);
        $auto = $background !== null ? ContrastEngine::autoForeground($background) : null;
        $text = is_array($design['text'] ?? null) ? $design['text'] : [];
        $explicitBody = self::colour($text['body'] ?? null, $config);
        $explicitHeading = self::colour($text['heading'] ?? null, $config);
        $link = self::colour($text['link'] ?? null, $config);
        $body = $explicitBody ?? $auto;
        $heading = $explicitHeading ?? $body;

        // خلف النص الصريح في قسمٍ بلا خلفية: خلفية الصفحة.
        $page = ContrastEngine::parseHex(self::PAGE_BACKGROUND);
        $judged = $background ?? (($explicitBody ?? $explicitHeading ?? $link) !== null && $page !== null
            ? ContrastEngine::solidInterval($page)
            : null);

        return ['body' => $body, 'heading' => $heading, 'link' => $link, 'background' => $background, 'judged' => $judged];
    }

    /**
     * أخطاء النشر لتصميم قسمٍ واحد. المفتاح هو الحقل الذي يصلحه التاجر.
     *
     * @param  array<string,mixed>  $design
     * @param  array<string,mixed>  $config
     * @return list<array{field:string,code:string,ratio:float}>
     */
    public static function issues(array $design, array $config): array
    {
        $text = self::effectiveText($design, $config);
        if ($text['judged'] === null) {
            return [];
        }
        $explicit = is_array($design['text'] ?? null) ? $design['text'] : [];
        $out = [];
        foreach (['body', 'heading', 'link'] as $field) {
            $colour = $text[$field];
            if ($colour === null) {
                continue;
            }
            $worst = ContrastEngine::worstRatioForHex($colour, $text['judged']);
            if (ContrastEngine::passes($worst)) {
                continue;
            }
            // لونٌ تلقائي فشل (تدرّج لا يُثبَت له أيٌّ من الأبيض/الأسود): الخلفية هي ما يُصلَح.
            $isExplicit = isset($explicit[$field]);
            $fieldOut = $isExplicit ? $field : 'background';
            if (! $isExplicit && $field !== 'body') {
                continue; // العنوان التلقائي = جسم النص؛ يُبلَّغ مرةً واحدة.
            }
            $out[$fieldOut.'|'.($isExplicit ? 'contrast_insufficient' : 'contrast_unprovable')] = [
                'field' => $fieldOut,
                'code' => $isExplicit ? 'contrast_insufficient' : 'contrast_unprovable',
                'ratio' => round($worst, 4),
            ];
        }

        return array_values($out);
    }

    /**
     * @param  array<string,mixed>  $normalized  وثيقة معيّرة
     * @return array<string, array{code:string,message:string}>
     */
    public static function errors(array $normalized): array
    {
        $sections = $normalized['homepage']['sections'] ?? null;
        if (! is_array($sections)) {
            return [];
        }
        $config = [
            'primaryColor' => $normalized['primaryColor'] ?? '#12372a',
            'accentColor' => $normalized['accentColor'] ?? null,
            'palette' => $normalized['palette'] ?? [],
        ];
        $errors = [];
        foreach (array_values($sections) as $i => $section) {
            if (! is_array($section) || ($section['visible'] ?? false) !== true || ! is_array($section['design'] ?? null)) {
                continue; // قسمٌ مخفي لا يُنشر فلا يُحجَب به النشر.
            }
            foreach (self::issues($section['design'], $config) as $issue) {
                $path = $issue['field'] === 'background'
                    ? "homepage.sections[{$i}].design.background"
                    : "homepage.sections[{$i}].design.text.{$issue['field']}";
                $errors[$path] = [
                    'code' => $issue['code'],
                    'message' => $issue['code'] === 'contrast_unprovable'
                        ? 'لا يمكن إثبات وضوح النص على هذه الخلفية بأيٍّ من الأبيض أو الأسود — غيّر الخلفية.'
                        : 'التباين بين لون النص وخلفية القسم أقل من 4.5:1 ولا يمكن نشره.',
                ];
            }
        }

        return $errors;
    }
}
