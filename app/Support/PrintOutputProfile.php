<?php

namespace App\Support;

/**
 * AWJ Output Profile v1 — عقد مقاس الإخراج وهوامشه لمراجعة قالب طباعة.
 *
 * يُخزَّن اختيارياً في `definition.output_profile` لمراجعة `PrintTemplateRevision`
 * القائمة: لا جدول ولا عمود ولا نظام إعدادات موازٍ. المراجعة المنشورة ثابتة
 * أصلاً (نموذجها يمنع تعديل `definition`) فيثبت معها الملف تاريخياً، والبصمة
 * `checksum` تغطيه.
 *
 * **الغياب = السلوك القديم حرفياً.** هذا الصنف لا يُستدعى إلا حين يوجد المفتاح؛
 * لا يفرض شيئاً على قالب بلا ملف، ولا يعيد حل قالب منشور أو مرحَّل.
 *
 * نقي (بلا قاعدة بيانات ولا حالة): يتحقق ثم يعيد الصيغة القانونية المُطبَّعة.
 * الصيغة المُطبَّعة تُقبل مدخلاً من جديد وتعود كما هي (idempotent) لأن النشر يعيد
 * التحقق من المخزَّن. لا قيمة نصية حرة مقبولة إطلاقاً غير معرّفات قوائم بيضاء،
 * وكل رقم عدد صحيح بالمليمتر: لا مجال لـCSS خام ولا لوحدات ("10mm") ولا كسور.
 *
 * مصدر الحقيقة المشترك مع الواجهة: `contracts/print-templates/output-profile.v1.json`
 * (يحرس تطابق الثوابت أدناه معه `PrintOutputProfileTest`). تغيير أي بُعد أو حدّ
 * يتطلب إصداراً جديداً للعقد، لا تعديل v1 (الملفات المخزَّنة تفسَّر بجدول v1).
 */
final class PrintOutputProfile
{
    public const VERSION = 1;
    public const KEY = 'output_profile';
    public const CUSTOM = 'custom';

    public const ORIENTATIONS = ['portrait', 'landscape'];
    public const MODES = ['page', 'roll'];

    /** معرّفات المقاسات الثابتة. المعرّفات الأربعة الأولى القديمة محفوظة كما هي في الواجهة. */
    public const PAPERS = [
        'a4'           => ['width_mm' => 210, 'height_mm' => 297, 'orientation' => 'portrait',  'output_mode' => 'page', 'default_margin_mm' => 14],
        'a4_landscape' => ['width_mm' => 297, 'height_mm' => 210, 'orientation' => 'landscape', 'output_mode' => 'page', 'default_margin_mm' => 14],
        'a5'           => ['width_mm' => 148, 'height_mm' => 210, 'orientation' => 'portrait',  'output_mode' => 'page', 'default_margin_mm' => 10],
        'a5_landscape' => ['width_mm' => 210, 'height_mm' => 148, 'orientation' => 'landscape', 'output_mode' => 'page', 'default_margin_mm' => 10],
        'a6'           => ['width_mm' => 105, 'height_mm' => 148, 'orientation' => 'portrait',  'output_mode' => 'page', 'default_margin_mm' => 8],
        'a6_landscape' => ['width_mm' => 148, 'height_mm' => 105, 'orientation' => 'landscape', 'output_mode' => 'page', 'default_margin_mm' => 8],
        'letter'       => ['width_mm' => 216, 'height_mm' => 279, 'orientation' => 'portrait',  'output_mode' => 'page', 'default_margin_mm' => 14],
        'legal'        => ['width_mm' => 216, 'height_mm' => 356, 'orientation' => 'portrait',  'output_mode' => 'page', 'default_margin_mm' => 14],
        'thermal_58'   => ['width_mm' => 58,  'height_mm' => null, 'orientation' => 'portrait', 'output_mode' => 'roll', 'default_margin_mm' => 0],
        'thermal_80'   => ['width_mm' => 80,  'height_mm' => null, 'orientation' => 'portrait', 'output_mode' => 'roll', 'default_margin_mm' => 0],
    ];

    public const CUSTOM_WIDTH_MM = [40, 420];
    public const CUSTOM_HEIGHT_MM = [40, 600];
    public const MARGIN_MM = [0, 50];
    /** أصغر عرض/ارتفاع قابل للطباعة بعد الهوامش (الارتفاع لوضع الصفحة فقط). */
    public const MIN_PRINTABLE_MM = 30;
    public const CUSTOM_DEFAULT_MARGIN_PAGE_MM = 10;
    public const CUSTOM_DEFAULT_MARGIN_ROLL_MM = 0;

    private const PROFILE_KEYS = ['version', 'paper', 'orientation', 'output_mode', 'margins_mm', 'custom'];
    private const SIDES = ['top', 'right', 'bottom', 'left'];
    private const CUSTOM_KEYS = ['width_mm', 'height_mm'];

    /** عارضا الإيصال الحراري المسجَّلان ومقاس كل منهما؛ ملف لا يطابقهما يُرفض. */
    public const THERMAL_TEMPLATE_PAPERS = [
        'tax-invoice-thermal58' => 'thermal_58',
        'tax-invoice-thermal80' => 'thermal_80',
    ];

    /**
     * يتحقق من الملف ويعيد صيغته القانونية الكاملة (كل الافتراضات مملوءة).
     *
     * @return array{version:int,paper:string,orientation:string,output_mode:string,margins_mm:array<string,int>,custom?:array{width_mm:int,height_mm:?int}}
     *
     * @throws PrintOutputProfileException
     */
    public static function normalize(mixed $raw): array
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            throw self::fail('not_an_object', 'ملف الإخراج يجب أن يكون كائناً منظماً.');
        }
        self::assertKnownKeys($raw, self::PROFILE_KEYS, 'ملف الإخراج');

        if (array_key_exists('version', $raw) && $raw['version'] !== self::VERSION) {
            throw self::fail('unsupported_version', 'إصدار ملف الإخراج غير مدعوم.');
        }

        $paper = $raw['paper'] ?? null;
        if (! is_string($paper) || ($paper !== self::CUSTOM && ! isset(self::PAPERS[$paper]))) {
            throw self::fail('paper_invalid', 'مقاس الورق غير مدعوم.');
        }

        $orientation = $raw['orientation'] ?? null;
        if ($orientation !== null && (! is_string($orientation) || ! in_array($orientation, self::ORIENTATIONS, true))) {
            throw self::fail('orientation_invalid', 'اتجاه الورق غير مدعوم.');
        }

        $mode = $raw['output_mode'] ?? null;
        if ($mode !== null && (! is_string($mode) || ! in_array($mode, self::MODES, true))) {
            throw self::fail('output_mode_invalid', 'نمط الإخراج غير مدعوم.');
        }

        $custom = null;
        if ($paper === self::CUSTOM) {
            [$orientation, $mode, $width, $height, $custom] = self::resolveCustom($raw, $orientation, $mode);
        } else {
            if (isset($raw['custom'])) {
                throw self::fail('custom_not_allowed', 'المقاس المخصص يُرسل مع المقاس «custom» فقط.');
            }
            [$paper, $orientation, $mode, $width, $height] = self::resolveFixed($paper, $orientation, $mode);
        }

        $defaultMargin = $paper === self::CUSTOM
            ? ($mode === 'roll' ? self::CUSTOM_DEFAULT_MARGIN_ROLL_MM : self::CUSTOM_DEFAULT_MARGIN_PAGE_MM)
            : self::PAPERS[$paper]['default_margin_mm'];
        $margins = self::resolveMargins($raw['margins_mm'] ?? null, $defaultMargin);

        if ($width - $margins['left'] - $margins['right'] < self::MIN_PRINTABLE_MM
            || ($height !== null && $height - $margins['top'] - $margins['bottom'] < self::MIN_PRINTABLE_MM)) {
            throw self::fail('printable_area_too_small', 'الهوامش تترك مساحة طباعة أصغر من الحد الأدنى.');
        }

        $profile = [
            'version'     => self::VERSION,
            'paper'       => $paper,
            'orientation' => $orientation,
            'output_mode' => $mode,
            'margins_mm'  => $margins,
        ];
        if ($custom !== null) {
            $profile['custom'] = $custom;
        }

        return $profile;
    }

    /**
     * الأبعاد الفعلية (مم) لملف مُطبَّع. الارتفاع null للفة (الارتفاع يُقاس من المحتوى).
     *
     * @param  array<string, mixed>  $profile  ناتج normalize()
     * @return array{width_mm:int,height_mm:?int}
     */
    public static function dimensions(array $profile): array
    {
        if ($profile['paper'] === self::CUSTOM) {
            return ['width_mm' => $profile['custom']['width_mm'], 'height_mm' => $profile['custom']['height_mm']];
        }
        $spec = self::PAPERS[$profile['paper']];

        return ['width_mm' => $spec['width_mm'], 'height_mm' => $spec['height_mm']];
    }

    /** @return array{0:string,1:string,2:int,3:?int,4:array{width_mm:int,height_mm:?int}} */
    private static function resolveCustom(array $raw, ?string $orientation, ?string $mode): array
    {
        $custom = $raw['custom'] ?? null;
        if ($custom === null) {
            throw self::fail('custom_required', 'المقاس المخصص يحتاج عرضاً (وارتفاعاً لوضع الصفحة).');
        }
        if (! is_array($custom) || ($custom !== [] && array_is_list($custom))) {
            throw self::fail('custom_invalid', 'المقاس المخصص يجب أن يكون كائناً منظماً.');
        }
        self::assertKnownKeys($custom, self::CUSTOM_KEYS, 'المقاس المخصص');

        $width = self::customDimension($custom['width_mm'] ?? null, self::CUSTOM_WIDTH_MM, 'العرض');
        $heightRaw = $custom['height_mm'] ?? null;

        $mode ??= $heightRaw === null ? 'roll' : 'page';
        if ($mode === 'roll' && $heightRaw !== null) {
            throw self::fail('output_mode_conflict', 'لفة الإيصال لا تحمل ارتفاعاً ثابتاً؛ يُقاس من المحتوى.');
        }
        $height = $mode === 'page'
            ? self::customDimension($heightRaw, self::CUSTOM_HEIGHT_MM, 'الارتفاع')
            : null;

        $derived = $height !== null && $width > $height ? 'landscape' : 'portrait';
        if ($orientation !== null && $orientation !== $derived) {
            throw self::fail('orientation_conflict', 'اتجاه الورق لا يطابق أبعاد المقاس المخصص.');
        }

        return [$derived, $mode, $width, $height, ['width_mm' => $width, 'height_mm' => $height]];
    }

    /** @return array{0:string,1:string,2:string,3:int,4:?int} */
    private static function resolveFixed(string $paper, ?string $orientation, ?string $mode): array
    {
        $spec = self::PAPERS[$paper];

        if ($orientation !== null && $orientation !== $spec['orientation']) {
            if ($spec['orientation'] === 'landscape') {
                throw self::fail('orientation_conflict', 'اتجاه الورق يخالف المقاس المحدد.');
            }
            // معرّف عمودي مع اتجاه أفقي: يرتقي إلى معرّف الأفقي القديم إن وُجد.
            if (! isset(self::PAPERS[$paper.'_landscape'])) {
                throw self::fail('orientation_unsupported', 'هذا المقاس لا يدعم الاتجاه الأفقي.');
            }
            $paper .= '_landscape';
            $spec = self::PAPERS[$paper];
        }

        if ($mode !== null && $mode !== $spec['output_mode']) {
            throw self::fail('output_mode_conflict', 'نمط الإخراج لا يطابق المقاس المحدد.');
        }

        return [$paper, $spec['orientation'], $spec['output_mode'], $spec['width_mm'], $spec['height_mm']];
    }

    /**
     * @param  array{0:int,1:int}  $range
     */
    private static function customDimension(mixed $value, array $range, string $label): int
    {
        if (! is_int($value)) {
            throw self::fail('custom_invalid', "{$label} المقاس المخصص يجب أن يكون عدداً صحيحاً بالمليمتر.");
        }
        if ($value < $range[0] || $value > $range[1]) {
            throw self::fail('custom_out_of_range', "{$label} المقاس المخصص يجب أن يقع بين {$range[0]} و{$range[1]} مم.");
        }

        return $value;
    }

    /** @return array{top:int,right:int,bottom:int,left:int} */
    private static function resolveMargins(mixed $raw, int $default): array
    {
        $margins = array_fill_keys(self::SIDES, $default);
        if ($raw === null) {
            return $margins;
        }
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            throw self::fail('margins_invalid', 'الهوامش يجب أن تكون كائناً بأضلاع top/right/bottom/left.');
        }
        self::assertKnownKeys($raw, self::SIDES, 'الهوامش');

        foreach ($raw as $side => $value) {
            if (! is_int($value)) {
                throw self::fail('margins_invalid', "هامش «{$side}» يجب أن يكون عدداً صحيحاً بالمليمتر.");
            }
            if ($value < self::MARGIN_MM[0] || $value > self::MARGIN_MM[1]) {
                throw self::fail('margins_out_of_range', 'الهامش يجب أن يقع بين '.self::MARGIN_MM[0].' و'.self::MARGIN_MM[1].' مم.');
            }
            $margins[$side] = $value;
        }

        return $margins;
    }

    /** @param array<int, string> $allowed */
    private static function assertKnownKeys(array $value, array $allowed, string $what): void
    {
        foreach (array_keys($value) as $key) {
            if (! is_string($key) || ! in_array($key, $allowed, true)) {
                throw self::fail('unknown_key', "{$what} يحوي خاصية غير مدعومة.");
            }
        }
    }

    private static function fail(string $reason, string $message): PrintOutputProfileException
    {
        return new PrintOutputProfileException($reason, $message);
    }
}
