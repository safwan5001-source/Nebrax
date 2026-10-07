<?php

namespace App\Services\Commerce;

use GdImage;
use Intervention\Image\Interfaces\ImageInterface;

/**
 * CUST-HV V6b-1 — دليل البكسل الذي يقوم عليه إثبات التباين فوق الصور (V0 §3.2.1 / §4.5 / AMEND-20).
 *
 * **ما يُقاس:** حدّا الحد الأدنى والأقصى لكل قناةٍ مرمَّزة (0–255) على **كل بكسلٍ** من أكبر إطارٍ
 * يمكن للمتصفح عرضه — أي أعرض درجةٍ في السلّم (≤ 1920) للإطار الافتراضي، أو أعرض عرضٍ مُصيَّر للإطار
 * المحوَّل (بعد الاتجاه والتدوير والقصّ والتكبير: AMEND-8، الدليل على **ما يُعرَض** لا على الأصل).
 * لا متوسط ولا عيّنة ولا طرفا تدرّج (§4.5.7): نقطةٌ ساخنة واحدة تغيّر الحدّ.
 *
 * **لماذا الحدّان يكفيان:** المتصفح يعرض تركيباتٍ محدَّبة من بكسلات المصدر (`object-fit: cover` وأي قصٍّ
 * أو تصغيرٍ يُظهر منطقةً جزئيةً أو متوسّطاتٍ لها)، فيبقى كل بكسلٍ معروض داخل حدّي الإطار الكامل مهما كان
 * العرض أو الارتفاع أو نقطة التركيز. وفوق ذلك {@see SLACK} مستويات تغطّي ترميز JPEG/WebP (رنين الحواف)
 * وإعادة أخذ العيّنات في المتصفح؛ وتُثبَّت قيمتها باختبارٍ على ملفاتٍ مرمَّزةٍ حقيقيةٍ بصورٍ عدائية.
 *
 * **الشفافية:** أي بكسلٍ شبه شفاف (`alpha` > {@see ALPHA_TOLERANCE}) يرفع العلم `alpha` — ما خلف الصورة
 * مجهول هنا فلا يُدَّعى إثبات؛ البوّابة تعامله على أنه غير قابل للإثبات (fail-closed).
 *
 * الشكل (مُنسَّخ بـ `v`) متعمَّد الانفتاح — V0 §19.0 تركه لـV5/V6 — ويُخزَّن في العمود المحجوز
 * `region_luminance` (اسمٌ باقٍ من المرحلة الأولى؛ ما يُخزَّن حدّا قنوات لا إضاءة).
 */
final class StorefrontMediaPixelEvidence
{
    public const VERSION = 1;

    /**
     * الهامش لكل قناةٍ على كل جانب = ثابتٌ + نسبةٌ من مدى القناة: رنين الترميز/إعادة العيّنات يتناسب مع
     * تباين الحافة (حافةٌ حادة 25|235 تُنتج ≈12٪ من مداها ≈ 25 مستوى)، فهامشٌ ثابت لا يصلح. تُثبِّت
     * اختباراتُ الدليل على ملفاتٍ مرمَّزةٍ حقيقيةٍ بصورٍ عدائية أنّ هذه القيم تغطي المقيس بهامش أمان.
     * (أعداد صحيحة بحتة ليتطابق PHP مع التوأمين TS بالبت.)
     */
    public const SLACK_ABS = 12;

    /** نسبة الرنين من مدى القناة بالمئة (تُقرَّب لأعلى). */
    public const SLACK_RINGING_PERCENT = 20;

    /** قيمة alpha في GD (0 معتم … 127 شفاف تماماً): ≤ هذا يقع داخل الهامش ولا يرفع العلم. */
    public const ALPHA_TOLERANCE = 2;

    /**
     * @return array{v:int, basis:string, width:int, height:int, min:list<int>, max:list<int>, alpha:bool, slack:array{abs:int, ringing:int}}
     */
    public static function scan(ImageInterface $image, string $basis = 'frame'): array
    {
        /** @var GdImage $gd */
        $gd = $image->core()->native();

        return self::scanGd($gd, $basis);
    }

    /**
     * اتحاد قياسَين لمجموعةٍ واحدة من الملفات: أدنى الأدنيات وأقصى الأقصيات، والشفافية إن وُجدت في أيٍّ منهما.
     * (أبعاد الناتج وأساسه من الأول — هما وصفٌ لا يدخل في الإثبات.)
     *
     * @param  array<string,mixed>  $a
     * @param  array<string,mixed>  $b
     * @return array<string,mixed>
     */
    public static function union(array $a, array $b): array
    {
        $a['min'] = [min($a['min'][0], $b['min'][0]), min($a['min'][1], $b['min'][1]), min($a['min'][2], $b['min'][2])];
        $a['max'] = [max($a['max'][0], $b['max'][0]), max($a['max'][1], $b['max'][1]), max($a['max'][2], $b['max'][2])];
        $a['alpha'] = $a['alpha'] || $b['alpha'];

        return $a;
    }

    /**
     * @return array{v:int, basis:string, width:int, height:int, min:list<int>, max:list<int>, alpha:bool, slack:array{abs:int, ringing:int}}
     */
    public static function scanGd(GdImage $gd, string $basis = 'frame'): array
    {
        $width = imagesx($gd);
        $height = imagesy($gd);
        $minR = $minG = $minB = 255;
        $maxR = $maxG = $maxB = 0;
        $alpha = false;
        // صورة بلوحة ألوان (PNG مفهرس): `imagecolorat` يعيد فهرس اللوحة لا ARGB — تُحلّ كل قيمةٍ عبر اللوحة
        // وإلا سُجِّلت قنواتٌ كاذبة (مثلاً [0,0,1]) وفاتت الشفافية، فيصير الدليل متفائلاً.
        $indexed = ! imageistruecolor($gd);

        for ($y = 0; $y < $height; $y++) {
            for ($x = 0; $x < $width; $x++) {
                $c = imagecolorat($gd, $x, $y);
                if ($indexed) {
                    $entry = imagecolorsforindex($gd, $c);
                    $c = ($entry['alpha'] << 24) | ($entry['red'] << 16) | ($entry['green'] << 8) | $entry['blue'];
                }
                if ((($c >> 24) & 0x7F) > self::ALPHA_TOLERANCE) {
                    $alpha = true;
                }
                $r = ($c >> 16) & 0xFF;
                $g = ($c >> 8) & 0xFF;
                $b = $c & 0xFF;
                if ($r < $minR) {
                    $minR = $r;
                }
                if ($r > $maxR) {
                    $maxR = $r;
                }
                if ($g < $minG) {
                    $minG = $g;
                }
                if ($g > $maxG) {
                    $maxG = $g;
                }
                if ($b < $minB) {
                    $minB = $b;
                }
                if ($b > $maxB) {
                    $maxB = $b;
                }
            }
        }

        return [
            'v' => self::VERSION,
            'basis' => $basis,
            'width' => $width,
            'height' => $height,
            'min' => [$minR, $minG, $minB],
            'max' => [$maxR, $maxG, $maxB],
            'alpha' => $alpha,
            'slack' => ['abs' => self::SLACK_ABS, 'ringing' => self::SLACK_RINGING_PERCENT],
        ];
    }

    /**
     * الحدّان بعد إضافة الهامش (مقصوصان إلى 0–255) — ما يُمرَّر إلى `ContrastEngine::channelBoundsInterval`.
     *
     * @param  array<string,mixed>  $evidence
     * @return array{min:list<int>, max:list<int>}|null  null = دليلٌ ناقصٌ أو بنسخةٍ غير معروفة أو بشفافية
     */
    public static function bounds(array $evidence): ?array
    {
        if (($evidence['v'] ?? null) !== self::VERSION || ($evidence['alpha'] ?? true) !== false) {
            return null;
        }
        $min = $evidence['min'] ?? null;
        $max = $evidence['max'] ?? null;
        if (! is_array($min) || ! is_array($max) || count($min) !== 3 || count($max) !== 3) {
            return null;
        }
        $outMin = [];
        $outMax = [];
        for ($i = 0; $i < 3; $i++) {
            if (! is_int($min[$i] ?? null) || ! is_int($max[$i] ?? null) || $min[$i] > $max[$i] || $min[$i] < 0 || $max[$i] > 255) {
                return null;
            }
            // الهامش من الثوابت المعتمدة لا مما خُزِّن: دليلٌ مخزَّنٌ بهامشٍ أضيق لا يضيّق الإثبات.
            $slack = self::SLACK_ABS + intdiv(self::SLACK_RINGING_PERCENT * ($max[$i] - $min[$i]) + 99, 100);
            $outMin[] = max(0, $min[$i] - $slack);
            $outMax[] = min(255, $max[$i] + $slack);
        }

        return ['min' => $outMin, 'max' => $outMax];
    }
}
