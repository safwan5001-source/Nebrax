<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V5e-2b — بوّابة تباين تسمية الأزرار العامة عند النشر (V0 §6.1 «تباين التسمية
 * يتبع §4.5»). السلطة (PHP) لتوأم TS (`buttonContrastIssues` في `global-tokens.ts`)،
 * وكلاهما على `tests/Fixtures/presentation/button-contrast.json`.
 *
 * ما يحتاج إثباتاً: أنماط **outline** و**link** فقط — تسميتها بلون الدور نفسه فوق ما خلف الزرّ
 * (خلفية الصفحة أو سطحٌ أبيض). نمطا solid وsoft يُحسب لهما لونُ التسمية تلقائياً فوق
 * ملئهما (الأبيض/الأسود الصافي الأفضل إثباتاً) فيمرّان بالبناء. داخل قسمٍ بخلفية مصمَّمة
 * تتبع هذه الأزرار مقدّمة القسم المُثبَتة أصلاً (بوّابة `SectionDesignContrast`) فلا تُقاس هنا.
 */
final class ButtonTokensContrast
{
    /** ما يمكن أن يقع خلف زرٍّ خارج قسمٍ مصمَّم: خلفية الصفحة اليوم وسطح البطاقة. */
    public const BACKDROPS = ['#f8f9fa', '#ffffff'];

    /**
     * @param  array<string,mixed>  $config  buttons / primaryColor / accentColor / palette
     * @return list<array{field:string,code:string,ratio:float}>
     */
    public static function issues(array $config): array
    {
        $buttons = $config['buttons'] ?? null;
        if (! is_array($buttons) || ! in_array($buttons['style'] ?? null, ['outline', 'link'], true)) {
            return [];
        }
        $role = is_string($buttons['colour'] ?? null) ? $buttons['colour'] : 'brand';
        $hex = SectionDesignContrast::roleHex($role, $config);
        if (ContrastEngine::parseHex($hex) === null) {
            return [];
        }
        $palette = is_array($config['palette'] ?? null) ? $config['palette'] : [];
        $backdrops = self::BACKDROPS;
        if (is_string($palette['surface'] ?? null) && ContrastEngine::parseHex($palette['surface']) !== null) {
            $backdrops[] = $palette['surface'];
        }
        $worst = null;
        foreach ($backdrops as $backdrop) {
            $ratio = ContrastEngine::worstRatioForHex($hex, ContrastEngine::solidInterval(ContrastEngine::parseHex($backdrop)));
            $worst = $worst === null ? $ratio : min($worst, $ratio);
        }

        return ContrastEngine::passes((float) $worst)
            ? []
            : [['field' => 'colour', 'code' => 'contrast_insufficient', 'ratio' => round((float) $worst, 4)]];
    }

    /**
     * @param  array<string,mixed>  $normalized  وثيقة معيّرة
     * @return array<string, array{code:string,message:string}>
     */
    public static function errors(array $normalized): array
    {
        $config = [
            'buttons' => $normalized['buttons'] ?? null,
            'primaryColor' => $normalized['primaryColor'] ?? '#12372a',
            'accentColor' => $normalized['accentColor'] ?? null,
            'palette' => $normalized['palette'] ?? [],
        ];
        $errors = [];
        foreach (self::issues($config) as $issue) {
            $errors['buttons.'.$issue['field']] = [
                'code' => $issue['code'],
                'message' => 'تباين لون الزرّ مع خلفية الصفحة أقل من 4.5:1 لهذا النمط ولا يمكن نشره — اختر لوناً أغمق أو نمط «ممتلئ».',
            ];
        }

        return $errors;
    }
}
