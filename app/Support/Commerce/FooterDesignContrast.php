<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V7e-1 — بوّابة تباين ألوان التذييل عند النشر (V0 §10.2 «كل أزواج النص/الرابط تمرّ بـ §4.5»). السلطة (PHP) لتوأم TS
 * (`footerContrastIssues` في `footer-design.ts`)، وكلاهما على `tests/Fixtures/presentation/footer-contrast.json`.
 *
 * ما يحتاج إثباتاً: ألوان `text` و`heading` و`link` **الصريحة** فقط، فوق ما يُرسم خلفها فعلاً — خلفية التذييل المصمَّمة إن وُجدت،
 * وإلا سطح التذييل الافتراضي القاتم. اللون التلقائي فوق خلفية مصمَّمة (الأبيض/الأسود الأفضل إثباتاً) يمرّ بالبناء فلا يُقاس هنا.
 */
final class FooterDesignContrast
{
    /** سطح التذييل الافتراضي (`--store-footer`) حين لا خلفية مصمَّمة. */
    public const DEFAULT_BACKDROP = '#111827';

    public const FIELDS = ['text', 'heading', 'link'];

    /**
     * @param  array<string,mixed>  $design  footer.design معيَّر
     * @param  array<string,mixed>  $config  primaryColor / accentColor / palette
     * @return list<array{field:string,code:string,ratio:float}>
     */
    public static function issues(array $design, array $config): array
    {
        $background = self::colour($design['surface']['background'] ?? null, $config);
        $backdrop = $background ?? self::DEFAULT_BACKDROP;
        $rgb = ContrastEngine::parseHex($backdrop);
        if ($rgb === null) {
            return [];
        }
        $issues = [];
        foreach (self::FIELDS as $field) {
            $hex = self::colour($design[$field] ?? null, $config);
            if ($hex === null) {
                continue;
            }
            $ratio = ContrastEngine::worstRatioForHex($hex, ContrastEngine::solidInterval($rgb));
            if (! ContrastEngine::passes($ratio)) {
                $issues[] = ['field' => $field, 'code' => 'contrast_insufficient', 'ratio' => round($ratio, 4)];
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
        $design = $normalized['footer']['design'] ?? null;
        if (! is_array($design)) {
            return [];
        }
        $config = [
            'primaryColor' => $normalized['primaryColor'] ?? '#12372a',
            'accentColor' => $normalized['accentColor'] ?? null,
            'palette' => $normalized['palette'] ?? [],
        ];
        $labels = ['text' => 'نص التذييل', 'heading' => 'عناوين التذييل', 'link' => 'روابط التذييل'];
        $errors = [];
        foreach (self::issues($design, $config) as $issue) {
            $errors["footer.design.{$issue['field']}"] = [
                'code' => $issue['code'],
                'message' => 'التباين بين لون '.$labels[$issue['field']].' وخلفية التذييل أقل من 4.5:1 ولا يمكن نشره.',
            ];
        }

        return $errors;
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
