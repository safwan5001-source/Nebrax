<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V7b — بوّابة تباين ألوان الترويسة عند النشر (V0 §9.2 / §9.4 «كل أزواج الألوان تمرّ بـ §4.5»).
 * السلطة (PHP) لتوأم TS (`headerContrastIssues` في `header-design.ts`)، وكلاهما على
 * `tests/Fixtures/presentation/header-contrast.json`.
 *
 * ما يحتاج إثباتاً: لونا `text` و`icon` **الصريحان** فقط، فوق ما يُرسم خلفهما فعلاً — خلفية الترويسة المصمَّمة
 * إن وُجدت، وإلا سطح المتجر (أبيض + `palette.surface` إن ضُبط). لون النص التلقائي فوق خلفية مصمَّمة
 * (الأبيض/الأسود الأفضل إثباتاً) يمرّ بالبناء فلا يُقاس هنا.
 */
final class HeaderDesignContrast
{
    /** ما يقع خلف الترويسة حين لا تكون لها خلفية مصمَّمة: سطح المتجر الافتراضي. */
    public const BACKDROPS = ['#ffffff'];

    /**
     * @param  array<string,mixed>  $design  header.design معيَّر
     * @param  array<string,mixed>  $config  primaryColor / accentColor / palette
     * @return list<array{field:string,code:string,ratio:float}>
     */
    public static function issues(array $design, array $config): array
    {
        $backdrops = self::backdrops($design, $config);
        $issues = [];
        foreach (['text', 'icon'] as $field) {
            $hex = self::colour($design[$field] ?? null, $config);
            if ($hex === null) {
                continue;
            }
            $worst = null;
            foreach ($backdrops as $backdrop) {
                $rgb = ContrastEngine::parseHex($backdrop);
                if ($rgb === null) {
                    continue;
                }
                $ratio = ContrastEngine::worstRatioForHex($hex, ContrastEngine::solidInterval($rgb));
                $worst = $worst === null ? $ratio : min($worst, $ratio);
            }
            if ($worst !== null && ! ContrastEngine::passes($worst)) {
                $issues[] = ['field' => $field, 'code' => 'contrast_insufficient', 'ratio' => round($worst, 4)];
            }
        }

        return $issues;
    }

    /**
     * @param  array<string,mixed>  $normalized  وثيقة معيّرة
     * @return array<string, array{code:string,message:string}>
     */
    public static function errors(array $normalized): array
    {
        $design = $normalized['header']['design'] ?? null;
        if (! is_array($design)) {
            return [];
        }
        $config = [
            'primaryColor' => $normalized['primaryColor'] ?? '#12372a',
            'accentColor' => $normalized['accentColor'] ?? null,
            'palette' => $normalized['palette'] ?? [],
        ];
        $errors = [];
        foreach (self::issues($design, $config) as $issue) {
            $errors["header.design.{$issue['field']}"] = [
                'code' => $issue['code'],
                'message' => $issue['field'] === 'icon'
                    ? 'التباين بين لون الأيقونات وخلفية الترويسة أقل من 4.5:1 ولا يمكن نشره.'
                    : 'التباين بين لون نص الترويسة وخلفيتها أقل من 4.5:1 ولا يمكن نشره.',
            ];
        }

        return $errors;
    }

    /**
     * @param  array<string,mixed>  $design
     * @param  array<string,mixed>  $config
     * @return list<string>
     */
    private static function backdrops(array $design, array $config): array
    {
        $background = self::colour($design['surface']['background'] ?? null, $config);
        if ($background !== null) {
            return [$background];
        }
        $backdrops = self::BACKDROPS;
        $palette = is_array($config['palette'] ?? null) ? $config['palette'] : [];
        if (is_string($palette['surface'] ?? null) && ContrastEngine::parseHex($palette['surface']) !== null) {
            $backdrops[] = $palette['surface'];
        }

        return $backdrops;
    }

    /** @param  array<string,mixed>  $config */
    private static function colour(mixed $ref, array $config): ?string
    {
        if (! is_array($ref)) {
            return null;
        }
        if (isset($ref['role']) && is_string($ref['role'])) {
            return SectionDesignContrast::roleHex($ref['role'], $config);
        }

        return is_string($ref['hex'] ?? null) && ContrastEngine::parseHex($ref['hex']) !== null ? $ref['hex'] : null;
    }
}
