<?php

namespace App\Support\Commerce;

use App\Services\Commerce\PresentationPublishValidationException;
use App\Services\Commerce\StorefrontMediaPublishGate;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * CUST-HV V3 — بوابة النشر: قواعد لا يجوز لمسودةٍ مخالفة لها أن تصير منشورة.
 * تُستدعى على الوثيقة **المطبَّعة** في كل مسارات النشر (فوري، قديم، مجدول عند
 * الجدولة وعند التنفيذ). السلطة هنا؛ المحرّر يعرض نفس النتيجة لحظياً فقط.
 *
 * الشرائح اللاحقة تضيف قواعدها هنا (نوافذ البانر V6، التباين العام V5،
 * مراجع الوسائط V2c) — مكانٌ واحد لا بوابة لكل ميزة.
 *
 * ما تفحصه V3 (شريط الإعلانات، العقد §12.2): لكل عنصرٍ **مفعَّل** في شريطٍ
 * مفعَّل:
 *  - نصٌّ غير فارغ؛
 *  - `window`: ISO-8601 صالح لكلتا الحافتين و`endsAt > startsAt` (AMEND-7 —
 *    `startsAt` شاملة و`endsAt` حصرية؛ المشوَّه لا يتحوّل إلى «بلا نافذة»)؛
 *  - تباين الألوان الصلبة ≥ 4.5:1 (نص/خلفية، رابط/خلفية) — حسابٌ دقيقٌ لأن
 *    اللونين معتمان؛ التدرّجات والصور (غير مدعومة في V3) لا تمرّ من هنا.
 */
final class StorefrontPresentationPublishValidator
{
    public const MIN_TEXT_CONTRAST = 4.5;

    private const ISO_UTC = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/';

    /** @param array<string, mixed> $normalized */
    public function assertPublishable(array $normalized): void
    {
        $errors = $this->errors($normalized);
        if ($errors !== []) {
            throw new PresentationPublishValidationException($errors);
        }
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @return array<string, array{code: string, message: string}>
     */
    public function errors(array $normalized): array
    {
        return $this->announcementErrors($normalized['announcements'] ?? null)
            + $this->mediaErrors($normalized);
    }

    /**
     * CUST-HV V2c — مراجع الوسائط: قراءة قاعدة البيانات فقط حين تحمل الوثيقة
     * `mediaId` (وثيقةٌ بلا وسائط لا تلمس القاعدة ولا تتغيّر نتيجتها). لا توليد
     * أبداً — انظر `StorefrontMediaPublishGate`.
     *
     * @param  array<string, mixed>  $normalized
     * @return array<string, array{code: string, message: string}>
     */
    private function mediaErrors(array $normalized): array
    {
        if (! str_contains((string) json_encode($normalized), '"mediaId"')) {
            return [];
        }

        return app(StorefrontMediaPublishGate::class)->errors($normalized);
    }

    /** @return array<string, array{code: string, message: string}> */
    private function announcementErrors(mixed $announcements): array
    {
        if (! is_array($announcements) || ($announcements['enabled'] ?? false) !== true) {
            return [];
        }

        $errors = [];
        foreach (array_values(is_array($announcements['items'] ?? null) ? $announcements['items'] : []) as $i => $item) {
            if (! is_array($item) || ($item['enabled'] ?? true) !== true) {
                continue; // لا يُعرض فلا يُحجَب به النشر.
            }
            $base = "announcements.items[{$i}]";

            if (trim((string) ($item['text'] ?? '')) === '') {
                $errors["{$base}.text"] = ['code' => 'announcement_text_required', 'message' => 'نص الإعلان مطلوب.'];
            }

            $window = is_array($item['window'] ?? null) ? $item['window'] : [];
            $starts = $this->parseInstant($window['startsAt'] ?? null, "{$base}.window.startsAt", $errors);
            $ends = $this->parseInstant($window['endsAt'] ?? null, "{$base}.window.endsAt", $errors);
            if ($starts !== null && $ends !== null && $ends->lessThanOrEqualTo($starts)) {
                $errors["{$base}.window.endsAt"] = [
                    'code' => 'window_end_not_after_start',
                    'message' => 'يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.',
                ];
            }

            $surface = is_array($item['surface'] ?? null) ? $item['surface'] : [];
            $background = $surface['background']['hex'] ?? null;
            if (is_string($background)) {
                foreach (['text', 'link'] as $role) {
                    $foreground = $surface[$role]['hex'] ?? null;
                    if (is_string($foreground) && self::contrastRatio($foreground, $background) < self::MIN_TEXT_CONTRAST) {
                        $errors["{$base}.surface.{$role}"] = [
                            'code' => 'contrast_insufficient',
                            'message' => 'التباين بين اللون والخلفية أقل من 4.5:1 ولا يمكن نشره.',
                        ];
                    }
                }
            }
        }

        return $errors;
    }

    /**
     * @param  array<string, array{code: string, message: string}>  $errors
     */
    private function parseInstant(mixed $value, string $path, array &$errors): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_string($value) || preg_match(self::ISO_UTC, $value) !== 1) {
            $errors[$path] = ['code' => 'window_invalid_timestamp', 'message' => 'صيغة التاريخ غير صالحة.'];

            return null;
        }
        try {
            $instant = CarbonImmutable::parse($value)->utc();
        } catch (Throwable) {
            $errors[$path] = ['code' => 'window_invalid_timestamp', 'message' => 'صيغة التاريخ غير صالحة.'];

            return null;
        }
        // صالحٌ تقويمياً وزمنياً: `2026-02-31` و`T24:00` و`T10:60` و`+25:00` تُقبل لدى بعض
        // المحلّلين بإزاحةٍ صامتة؛ نرفضها صراحةً. (نفس القواعد في `parseAnnouncementInstant` بـTS.)
        if (! self::isCalendarAndClockValid($value)) {
            $errors[$path] = ['code' => 'window_invalid_timestamp', 'message' => 'تاريخ أو وقت غير موجود.'];

            return null;
        }

        return $instant;
    }

    private static function isCalendarAndClockValid(string $value): bool
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/', $value, $m) !== 1) {
            return false;
        }
        if (! checkdate((int) $m[2], (int) $m[3], (int) $m[1]) || (int) $m[4] > 23 || (int) $m[5] > 59 || (int) ($m[6] ?? 0) > 59) {
            return false;
        }

        return ! isset($m[8]) || ((int) $m[8] <= 23 && (int) $m[9] <= 59);
    }

    /** نسبة التباين WCAG 2.x بين لونين معتمين (`#rrggbb`). */
    public static function contrastRatio(string $foreground, string $background): float
    {
        $a = self::relativeLuminance($foreground);
        $b = self::relativeLuminance($background);

        return (max($a, $b) + 0.05) / (min($a, $b) + 0.05);
    }

    public static function relativeLuminance(string $hex): float
    {
        $channels = array_map(
            static function (int $v): float {
                $c = $v / 255;

                return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
            },
            [hexdec(substr($hex, 1, 2)), hexdec(substr($hex, 3, 2)), hexdec(substr($hex, 5, 2))],
        );

        return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
    }

    /**
     * المقدّمة التلقائية: الأبيض أو **الأسود الصافي** — أيهما أعلى تبايناً (يربط
     * عند التساوي بالأبيض). الأسود الصافي لا شبه الأسود عمداً: الأفضل من
     * الأبيض/الأسود ≥ 4.58:1 على أي لون معتم، بينما `#111827` ينزل إلى ≈ 4.40:1
     * على الدرجات الوسطى فيكذب ضمان «لا يُرفض أي لون خلفية» (V0 §4.5.1).
     */
    public static function autoForeground(string $backgroundHex): string
    {
        return self::contrastRatio('#ffffff', $backgroundHex) >= self::contrastRatio('#000000', $backgroundHex)
            ? '#ffffff'
            : '#000000';
    }
}
