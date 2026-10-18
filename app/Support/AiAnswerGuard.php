<?php

namespace App\Support;

/**
 * حارس جواب النموذج الخارجي (AI-07): تنظيف + **تأريض الأرقام** + إعادة ربط الأسماء محلياً.
 *
 * النموذج لا يُنتج أرقاماً معتمدة: كل رقم في جوابه يجب أن يكون واحداً مما قُدّم له في ملخّص الأداة (أو عدداً صغيراً
 * < 100 كعدّ أيام/أطراف). رقم مخترَع أو مشتقّ (مجموع جديد، نسبة) يُسقط الجواب كله إلى رسالة ثابتة تحيل إلى بطاقات
 * النتائج المعتمدة؛ لا يُصلَح الجواب بصمت.
 */
final class AiAnswerGuard
{
    private const DIGITS = ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        '٫' => '.', '٬' => ','];

    /** نصّ عادي بلا محارف تحكّم ولا علامات اتجاه مخفية ولا روابط قابلة للنقر، ومقصوص. */
    public static function sanitize(string $text, int $maxChars): string
    {
        $clean = preg_replace('/[\p{Cc}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]+/u', ' ', $text) ?? '';
        $clean = preg_replace('/\s{3,}/u', "\n\n", trim($clean)) ?? '';

        return mb_substr($clean, 0, max(1, $maxChars));
    }

    /** @param array<string,mixed> $digests ملخّصات الأدوات التي قُدّمت للنموذج. */
    public static function isGrounded(string $answer, array $digests): bool
    {
        $allowed = array_flip(self::numbers((string) json_encode($digests, JSON_UNESCAPED_UNICODE)));
        foreach (self::numbers($answer) as $number) {
            if (isset($allowed[$number])) {
                continue;
            }
            // عدد صحيح صغير (أيام، عدد أطراف، ترقيم) مقبول؛ أي رقم من 3 خانات فأكثر أو كسري يجب أن يكون من الملخّص.
            if (preg_match('/^\d{1,2}$/', $number) === 1) {
                continue;
            }

            return false;
        }

        return true;
    }

    /** يعيد رموز `Party-N` إلى أسماء أطراف المستخدم نفسه — محلياً وبعد الجواب. @param array<string,string> $names */
    public static function restoreNames(string $answer, array $names): string
    {
        if ($names === []) {
            return $answer;
        }
        // الأطول أولاً كي لا يُستبدل `Party-1` داخل `Party-10`.
        uksort($names, static fn (string $a, string $b): int => strlen($b) <=> strlen($a));

        return strtr($answer, array_filter($names, static fn (string $v): bool => $v !== ''));
    }

    /** @return list<string> أرقام متقنَّنة (بلا فواصل آلاف ولا أصفار كسرية لاحقة). */
    private static function numbers(string $text): array
    {
        $text = strtr($text, self::DIGITS);
        // الإشارة جزء من الهوية المحاسبية: 2,075 و-2,075 ليسا رقماً واحداً.
        $text = str_replace(['−', '﹣', '－'], '-', $text);
        preg_match_all('/(?<![\d.])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/u', $text, $m);
        return array_values(array_unique(array_map(static function (string $n): string {
            $negative = str_starts_with($n, '-');
            $n = ltrim($n, '-');
            $n = str_replace(',', '', $n);
            if (str_contains($n, '.')) {
                $n = rtrim(rtrim($n, '0'), '.');
            }
            return ($negative ? '-' : '') . ($n === '' ? '0' : $n);
        }, $m[0])));
    }
}
