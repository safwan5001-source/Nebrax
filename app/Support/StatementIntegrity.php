<?php

namespace App\Support;

/**
 * AIA-0.1 — فحوص سلامة كشف حساب الطرف: دالة نقية بأعداد صحيحة فقط.
 *
 * تحسب الإجماليات (مجموع المدين/الدائن/الصافي) من **الصفوف الأصلية** لا من أي رقم مُدخَل، وتعيد نتيجة كل فحص.
 * لا `float` ولا تقريب ولا قسمة.
 *
 * **حدّ الأمان `MAX_SAFE_MINOR = 2^53 − 1` يسري على كل قيمة محسوبة لا على المدخلات وحدها:** كل جمع (مجموع المدين،
 * مجموع الدائن، الصافي، الرصيد الجاري المعاد حسابه، الختامي المتوقع) يمرّ عبر `addSafe` الذي يعدّ النتيجة فاشلة
 * إن تجاوز النطاق الآمن — حتى لو بقي داخل `PHP_INT_MAX` وكانت كل حركة منفردة آمنة (حركات متوازنة متكررة تُبقي
 * الرصيد الجاري صغيراً بينما يكبر إجمالي كل جانب). وهذا فوق كشف فيض `int` الذي يحوّله PHP إلى `float` بصمت.
 * عند فشل الجمع لا تُعاد إجماليات جزئية: `debit_minor`/`credit_minor`/`net_minor` = `null` (لا صفر مضلّل)،
 * و`row_count` وحده يبقى لأنه عدّ لا جمع.
 *
 * الفحوص الناجحة تعني اتساقاً داخلياً حسابياً فقط. لا تعني أن الكشف يطابق دفاتر الطرف أو المستندات، ولا أن البيانات
 * مكتملة: `row_count_matches_rows` يقارن عدد الصفوف المفحوصة بعدد الصفوف المُخرَجة، وكلاهما مشتق من المصفوفة نفسها،
 * فهو يحرس طبقة التسلسل (صف مفقود/مكرَّر عند التحويل) ولا يثبت اكتمال المصدر. تحقق الاكتمال المستقل = AIA-0.2.
 */
final class StatementIntegrity
{
    /** 2^53 − 1 = Number.MAX_SAFE_INTEGER. */
    public const MAX_SAFE_MINOR = 9007199254740991;

    public const CHECK_MINOR_INTEGERS = 'minor_units_are_integers';
    public const CHECK_SAFE_RANGE = 'computed_values_within_safe_range';
    public const CHECK_NON_NEGATIVE = 'amounts_are_non_negative';
    public const CHECK_RUNNING_CHAIN = 'running_balance_chain';
    public const CHECK_CLOSING_EQUALS = 'closing_equals_opening_plus_net';
    public const CHECK_ROW_COUNT = 'row_count_matches_rows';

    /**
     * @param  array<int, array{debit:mixed, credit:mixed, balance:mixed}>  $rows  الصفوف كما أعادتها `ReportService::partnerStatement`
     * @param  int|null  $emittedRowCount  عدد الصفوف التي ستُخرَج فعلاً في الاستجابة (يُقارَن بما فُحص؛ ليس إثبات اكتمال مستقلاً)
     * @return array{
     *   totals: array{row_count:int, debit_minor:?int, credit_minor:?int, net_minor:?int},
     *   checks: list<array{id:string, passed:bool}>,
     *   passed: bool,
     *   failed: list<string>
     * }
     */
    public static function evaluate(mixed $opening, array $rows, mixed $closing, ?int $emittedRowCount = null): array
    {
        $integers = self::isSafeMinor($opening) && self::isSafeMinor($closing);
        $nonNegative = true;
        foreach ($rows as $row) {
            $debit = is_array($row) ? ($row['debit'] ?? null) : null;
            $credit = is_array($row) ? ($row['credit'] ?? null) : null;
            $balance = is_array($row) ? ($row['balance'] ?? null) : null;
            if (! self::isSafeMinor($debit) || ! self::isSafeMinor($credit) || ! self::isSafeMinor($balance)) {
                $integers = false;
            } elseif ($debit < 0 || $credit < 0) {
                $nonNegative = false;
            }
        }

        $totals = ['row_count' => count($rows), 'debit_minor' => null, 'credit_minor' => null, 'net_minor' => null];
        $chain = false;
        $closingMatches = false;
        $withinRange = false;

        if ($integers) {
            $debitSum = 0;
            $creditSum = 0;
            $running = $opening;
            $chain = true;
            foreach ($rows as $row) {
                $debitSum = self::addSafe($debitSum, $row['debit']);
                $creditSum = self::addSafe($creditSum, $row['credit']);
                $running = self::addSafe($running, self::addSafe($row['debit'], -$row['credit']));
                if ($running !== $row['balance']) { // null (خارج النطاق الآمن) لا يساوي عدداً صحيحاً
                    $chain = false;
                }
            }
            $net = $creditSum === null ? null : self::addSafe($debitSum, -$creditSum);
            $withinRange = $debitSum !== null && $creditSum !== null && $net !== null;

            if ($withinRange) {
                $totals['debit_minor'] = $debitSum;
                $totals['credit_minor'] = $creditSum;
                $totals['net_minor'] = $net;
                $closingMatches = self::addSafe($opening, $net) === $closing;
            }
        }

        $checks = [
            ['id' => self::CHECK_MINOR_INTEGERS, 'passed' => $integers],
            ['id' => self::CHECK_SAFE_RANGE, 'passed' => $withinRange],
            ['id' => self::CHECK_NON_NEGATIVE, 'passed' => $integers && $nonNegative],
            ['id' => self::CHECK_RUNNING_CHAIN, 'passed' => $chain],
            ['id' => self::CHECK_CLOSING_EQUALS, 'passed' => $closingMatches],
            ['id' => self::CHECK_ROW_COUNT, 'passed' => $emittedRowCount === null || $emittedRowCount === count($rows)],
        ];
        $failed = array_values(array_map(
            static fn (array $c): string => $c['id'],
            array_filter($checks, static fn (array $c): bool => ! $c['passed'])
        ));

        return ['totals' => $totals, 'checks' => $checks, 'passed' => $failed === [], 'failed' => $failed];
    }

    /** عدد صحيح فعلاً (ليس float/نصاً) داخل النطاق الآمن. */
    public static function isSafeMinor(mixed $value): bool
    {
        return is_int($value) && $value >= -self::MAX_SAFE_MINOR && $value <= self::MAX_SAFE_MINOR;
    }

    /**
     * جمع صحيح دقيق داخل النطاق الآمن؛ `null` عند فيض `int` (لا تحويل صامت إلى float) أو عند تجاوز `±MAX_SAFE_MINOR`.
     * الحدّان الموجب والسالب متماثلان: `-MAX_SAFE_MINOR` مقبول و`-MAX_SAFE_MINOR - 1` مرفوض.
     */
    public static function addSafe(?int $a, ?int $b): ?int
    {
        if ($a === null || $b === null) {
            return null;
        }
        $sum = $a + $b;

        return is_int($sum) && self::isSafeMinor($sum) ? $sum : null;
    }
}
