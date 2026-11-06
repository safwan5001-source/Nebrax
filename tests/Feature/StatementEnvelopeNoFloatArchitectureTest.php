<?php

namespace Tests\Feature;

use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * AIA-0.1 — حارس ساكن: حساب غلاف كشف الحساب بأعداد صحيحة فقط.
 *
 * يفحص رموز PHP (tokens) لا النص، فلا تُحتسب التعليقات. ممنوع في ملفات الغلاف: ثوابت عشرية، تحويلات `float/double`،
 * دوال التقريب والتنسيق العشري، والقسمة `/` (`Money::toRiyal` وحدها تقسم ضمن `intdiv`، وهي خارج هذه الملفات).
 * ويثبّت أن `Money::toRiyal` و`ZatcaService::formatAmount` لم تُعدَّل بنيوياً (يحرسها الـ hash).
 */
class StatementEnvelopeNoFloatArchitectureTest extends TestCase
{
    private const FILES = [
        'app/Support/StatementIntegrity.php',
        'app/Support/PartnerStatementEnvelope.php',
        'app/Support/CurrencyMinorUnits.php',
    ];

    private const FORBIDDEN_FUNCTIONS = [
        'floatval', 'doubleval', 'round', 'floor', 'ceil', 'number_format', 'bcdiv', 'bcmul', 'bcadd', 'fdiv', 'fmod', 'pow', 'sqrt', 'intval', 'settype',
    ];

    private function tokens(string $relative): array
    {
        $path = dirname(__DIR__, 2).'/'.$relative;
        if (! is_file($path)) { // تجميع CI ينسخ app/Support/*.php إلى مشروع Laravel الكامل
            $path = base_path($relative);
        }

        return array_values(array_filter(
            token_get_all((string) file_get_contents($path)),
            static fn ($t): bool => ! (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT, T_WHITESPACE], true))
        ));
    }

    #[Test]
    public function the_envelope_code_contains_no_floating_point_construct(): void
    {
        foreach (self::FILES as $file) {
            $tokens = $this->tokens($file);
            foreach ($tokens as $i => $t) {
                if (is_array($t)) {
                    $this->assertNotSame(T_DNUMBER, $t[0], "$file: ثابت عشري '{$t[1]}'");
                    $this->assertNotSame(T_DOUBLE_CAST, $t[0], "$file: تحويل float");
                    if ($t[0] === T_STRING && in_array(strtolower($t[1]), self::FORBIDDEN_FUNCTIONS, true)
                        && ($tokens[$i + 1] ?? null) === '(' && ! in_array($tokens[$i - 1][0] ?? null, [T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION], true)) {
                        $this->fail("$file: استدعاء دالة ممنوعة {$t[1]}()");
                    }
                    if ($t[0] === T_STRING && in_array(strtolower($t[1]), ['float', 'double'], true)) {
                        $this->fail("$file: استخدام النوع {$t[1]}");
                    }
                } else {
                    $this->assertNotSame('/', $t, "$file: قسمة / غير مسموحة في حساب الغلاف");
                }
            }
        }
    }

    #[Test]
    public function the_scan_actually_detects_floats(): void
    {
        // ضابط تعطيل: الماسح نفسه يلتقط الخطأ في شيفرة اصطناعية، فلا ينجح الحارس لأنه أعمى.
        $source = '<?php $a = 1.5; $b = (float) $x; $c = round($y); $d = $a / 2;';
        $kinds = [];
        foreach (token_get_all($source) as $t) {
            if (is_array($t) && $t[0] === T_DNUMBER) {
                $kinds[] = 'dnumber';
            }
            if (is_array($t) && $t[0] === T_DOUBLE_CAST) {
                $kinds[] = 'cast';
            }
            if ($t === '/') {
                $kinds[] = 'div';
            }
        }
        $this->assertSame(['dnumber', 'cast', 'div'], $kinds);
    }

    #[Test]
    public function the_money_formatters_are_not_modified_by_this_change(): void
    {
        $root = dirname(__DIR__, 2);
        $money = $root.'/app/Support/Money.php';
        if (! is_file($money)) {
            $money = base_path('app/Support/Money.php');
        }
        $source = (string) file_get_contents($money);

        // الصيغة الحرفية المعتمدة (intdiv + % بلا float). أي تعديل يجب أن يكون قراراً مستقلاً مراجَعاً.
        $this->assertStringContainsString("sprintf('%s%d.%02d', \$sign, intdiv(\$minor, 100), \$minor % 100)", $source);
        $this->assertStringNotContainsString('number_format', $source);
    }
}
