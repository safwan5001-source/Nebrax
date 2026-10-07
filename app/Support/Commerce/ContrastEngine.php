<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V5a — محرّك التباين (V0 §3.2.1 / §4.5، AMEND-20).
 *
 * V0 جمّد **الثابت** لا الخوارزمية: أي نصٍّ معلوماتي فوق لونٍ أو تدرّجٍ أو تراكبٍ
 * يجب أن يستوفي عتبة WCAG مقابل **النتيجة المرسومة فعلاً**؛ لا متوسّط منطقة ولا
 * فحص طرفَي تدرّج بمفرده، و«غير مُثبَت» = «غير مطابق». هذا الملف هو الخوارزمية
 * المختارة والمُثبَتة في V5، وتوأماه TS (`contrast-engine.ts` في web وstorefront،
 * متطابقان حرفياً) يُشغَّل ثلاثتها على `tests/Fixtures/presentation/contrast.json`.
 *
 * **النموذج (كلّه فوق القيم المشفّرة gamma كما يفعل المتصفح):**
 *  1. التركيب (تراكب بألفا) خطّي على القنوات المشفّرة sRGB — لا على الخطّي-الضوئي.
 *  2. تدرّج CSS الخطّي يُستكمل على القنوات المشفّرة؛ والتراكب فوق تدرّجٍ = تدرّجٌ
 *     بين طرفين مركّبين (التركيب والاستكمال كلاهما خطّي) فيُركَّب الطرفان فقط.
 *  3. الاتجاه لا يدخل الحساب: مكان النص داخل القسم مجهول، فيُفحص **المدى كلّه**.
 *  4. اللمعان بعد التحويل غير الخطّي ليس خطّياً → لا نكتفي بالطرفين: نأخذ عيّنات
 *     كثيفة (GRADIENT_SAMPLES) ثم **نوسّع المدى بحدٍّ برهاني**: دالّة اللمعان
 *     Lipschitz بثابت K = Σ wᵢ·ميل(cᵢ)·|Δᵢ| (الميل المحلّي لـ lin(c) متزايد، أقصاه 2.4/1.055 عند c=1)،
 *     فأي نقطة تبعد عن أقرب عيّنة ≤ δt/2 ⇒ انحرافها ≤ K·δt/2.
 *  5. تقريب المتصفح: يُضاف هامش roundSlack (درجة قناة كاملة × الميل المحلّي — مقيس).
 *  6. صور المنطقة: تُغذّى بحدود القنوات المشفّرة (min/max) من بكسلات المنطقة
 *     المرسومة فعلاً (V6)؛ اللمعان رتيب في كل قناة فالحدّان صارمان (لا متوسّط).
 *  7. النسبة الأسوأ على المدى [Lmin, Lmax] مقابل لمعان المقدّمة Lf: إن وقعت Lf داخل
 *     المدى فالنسبة الأسوأ 1 (تعبر الخلفية لمعان النص) — فيفشل بلا شرط.
 */
final class ContrastEngine
{
    public const TEXT_NORMAL = 4.5;

    /** النص الكبير (≥ 24px أو ≥ 18.66px عريض) وعناصر الواجهة غير النصية. */
    public const TEXT_LARGE = 3.0;

    public const GRADIENT_SAMPLES = 1024;

    /** أقصى d lin(c)/d c لـ c في [0,1] (عند c=1: 2.4/1.055). */
    public const SLOPE = 2.4 / 1.055;

    /**
     * درجة قناة كاملة من 255. أثبت قياس Chromium على بكسلات مرسومة فعلاً (انظر
     * e2e/cust-hv-v5a-contrast-render-proof) انحرافاً حتى 0.99 درجة عن الاستكمال
     * المثالي (تقريب/تنعيم التدرّج) — فلا يكفي نصف درجة.
     */
    public const LEVEL_ERROR = 1 / 255;

    private const W_R = 0.2126;

    private const W_G = 0.7152;

    private const W_B = 0.0722;

    /** @return array{0:int,1:int,2:int}|null */
    public static function parseHex(string $hex): ?array
    {
        if (preg_match('/^#([0-9a-fA-F]{6})$/', trim($hex), $m) !== 1) {
            return null;
        }
        $n = hexdec($m[1]);

        return [($n >> 16) & 255, ($n >> 8) & 255, $n & 255];
    }

    /** لمعان WCAG النسبي لقنواتٍ مشفّرة 0–255 (قد تكون عشرية بعد التركيب). */
    public static function luminance(float $r, float $g, float $b): float
    {
        return self::W_R * self::lin($r) + self::W_G * self::lin($g) + self::W_B * self::lin($b);
    }

    /**
     * ميل lin(c) المحلّي عند c في [0,1]؛ متزايد في c فيكفي تقييمه عند الحدّ الأعلى.
     */
    private static function slopeAt(float $c): float
    {
        $c = max(0.0, min(1.0, $c));

        return $c <= 0.03928 ? 1 / 12.92 : (2.4 / 1.055) * ((($c + 0.055) / 1.055) ** 1.4);
    }

    /**
     * هامش تقريب المتصفح لمدى لونٍ حدّه الأعلى بالقنوات `$hi` (0–255):
     * Σ wᵢ · ميل(cᵢ + درجة) · درجة — صارم وأضيق كثيراً من الميل الأقصى العام.
     *
     * @param  array{0:float|int,1:float|int,2:float|int}  $hi
     */
    private static function roundSlack(array $hi): float
    {
        $slack = 0.0;
        foreach ([self::W_R, self::W_G, self::W_B] as $i => $w) {
            $slack += $w * self::slopeAt($hi[$i] / 255 + self::LEVEL_ERROR) * self::LEVEL_ERROR;
        }

        return $slack;
    }

    private static function lin(float $channel): float
    {
        $c = max(0.0, min(255.0, $channel)) / 255;

        return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
    }

    public static function ratio(float $a, float $b): float
    {
        return (max($a, $b) + 0.05) / (min($a, $b) + 0.05);
    }

    /**
     * تركيب لونٍ بألفا فوق لونٍ معتم — على القنوات المشفّرة.
     *
     * @param  array{0:float|int,1:float|int,2:float|int}  $fg
     * @param  array{0:float|int,1:float|int,2:float|int}  $bg
     * @return array{0:float,1:float,2:float}
     */
    public static function composite(array $fg, float $alpha, array $bg): array
    {
        $a = max(0.0, min(1.0, $alpha));

        return [
            $a * $fg[0] + (1 - $a) * $bg[0],
            $a * $fg[1] + (1 - $a) * $bg[1],
            $a * $fg[2] + (1 - $a) * $bg[2],
        ];
    }

    /**
     * مدى اللمعان لخلفية صلبة (اختيارياً تحت تراكب).
     *
     * @param  array{0:int,1:int,2:int}  $color
     * @param  array{rgb:array{0:int,1:int,2:int},alpha:float}|null  $overlay
     * @return array{min:float,max:float}
     */
    public static function solidInterval(array $color, ?array $overlay = null): array
    {
        $c = $overlay === null ? $color : self::composite($overlay['rgb'], $overlay['alpha'], $color);
        $l = self::luminance($c[0], $c[1], $c[2]);
        $slack = $overlay === null ? 0.0 : self::roundSlack($c);

        return self::clampInterval($l - $slack, $l + $slack);
    }

    /**
     * مدى اللمعان على امتداد تدرّجٍ خطّي بين لونين معتمين (اختيارياً تحت تراكب).
     *
     * @param  array{0:int,1:int,2:int}  $from
     * @param  array{0:int,1:int,2:int}  $to
     * @param  array{rgb:array{0:int,1:int,2:int},alpha:float}|null  $overlay
     * @return array{min:float,max:float}
     */
    public static function gradientInterval(array $from, array $to, ?array $overlay = null): array
    {
        $a = $overlay === null ? $from : self::composite($overlay['rgb'], $overlay['alpha'], $from);
        $b = $overlay === null ? $to : self::composite($overlay['rgb'], $overlay['alpha'], $to);

        $min = INF;
        $max = -INF;
        for ($i = 0; $i <= self::GRADIENT_SAMPLES; $i++) {
            $t = $i / self::GRADIENT_SAMPLES;
            $l = self::luminance(
                $a[0] + ($b[0] - $a[0]) * $t,
                $a[1] + ($b[1] - $a[1]) * $t,
                $a[2] + ($b[2] - $a[2]) * $t,
            );
            $min = min($min, $l);
            $max = max($max, $l);
        }

        $hi = [max($a[0], $b[0]), max($a[1], $b[1]), max($a[2], $b[2])];
        $k = (
            self::W_R * self::slopeAt($hi[0] / 255) * abs($b[0] - $a[0])
            + self::W_G * self::slopeAt($hi[1] / 255) * abs($b[1] - $a[1])
            + self::W_B * self::slopeAt($hi[2] / 255) * abs($b[2] - $a[2])
        ) / 255;
        $slack = $k / (2 * self::GRADIENT_SAMPLES) + self::roundSlack($hi);

        return self::clampInterval($min - $slack, $max + $slack);
    }

    /**
     * مدى اللمعان لمنطقةٍ تُعرف بحدود قنواتها المشفّرة (بكسلات مرسومة فعلاً)،
     * اختيارياً تحت تراكب. اللمعان رتيب في كل قناة فالحدّان صارمان.
     *
     * @param  array{0:int|float,1:int|float,2:int|float}  $minRgb
     * @param  array{0:int|float,1:int|float,2:int|float}  $maxRgb
     * @param  array{rgb:array{0:int,1:int,2:int},alpha:float}|null  $overlay
     * @return array{min:float,max:float}
     */
    public static function channelBoundsInterval(array $minRgb, array $maxRgb, ?array $overlay = null): array
    {
        $lo = $overlay === null ? $minRgb : self::composite($overlay['rgb'], $overlay['alpha'], $minRgb);
        $hi = $overlay === null ? $maxRgb : self::composite($overlay['rgb'], $overlay['alpha'], $maxRgb);
        $slack = $overlay === null ? 0.0 : self::roundSlack($hi);

        return self::clampInterval(
            self::luminance($lo[0], $lo[1], $lo[2]) - $slack,
            self::luminance($hi[0], $hi[1], $hi[2]) + $slack,
        );
    }

    /**
     * أسوأ نسبة تباين لمقدّمةٍ بلمعان `$fgLuminance` على خلفيةٍ يقع لمعانها في المدى.
     *
     * @param  array{min:float,max:float}  $interval
     */
    public static function worstRatio(float $fgLuminance, array $interval): float
    {
        if ($fgLuminance >= $interval['max']) {
            return ($fgLuminance + 0.05) / ($interval['max'] + 0.05);
        }
        if ($fgLuminance <= $interval['min']) {
            return ($interval['min'] + 0.05) / ($fgLuminance + 0.05);
        }

        return 1.0;
    }

    /** أسوأ نسبة للمقدّمة `#rrggbb`؛ لون غير صالح ⇒ 1 (غير مُثبَت = غير مطابق). */
    public static function worstRatioForHex(string $foreground, array $interval): float
    {
        $rgb = self::parseHex($foreground);
        if ($rgb === null) {
            return 1.0;
        }

        return self::worstRatio(self::luminance($rgb[0], $rgb[1], $rgb[2]), $interval);
    }

    /** يمرّ فقط إن أُثبت الاستيفاء؛ لا «لم نجد مخالفة». */
    public static function passes(float $worstRatio, float $threshold = self::TEXT_NORMAL): bool
    {
        return $worstRatio >= $threshold;
    }

    /**
     * أفضل مقدّمة تلقائية من الأبيض والأسود الصافيين لمدى خلفية (يربط بالأبيض).
     *
     * @param  array{min:float,max:float}  $interval
     */
    public static function autoForeground(array $interval): string
    {
        return self::worstRatio(1.0, $interval) >= self::worstRatio(0.0, $interval) ? '#ffffff' : '#000000';
    }

    /** @return array{min:float,max:float} */
    private static function clampInterval(float $min, float $max): array
    {
        return ['min' => max(0.0, $min), 'max' => min(1.0, $max)];
    }
}
