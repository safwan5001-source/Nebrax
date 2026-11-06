<?php

namespace App\Support;

/**
 * AIA-0.1 — فحوص سلامة كشف حساب الطرف: دالة نقية بأعداد صحيحة فقط.
 *
 * تُعيد الإجماليات (مجموع المدين/الدائن/الصافي) محسوبةً من **الصفوف الأصلية** لا من أي رقم مُدخَل،
 * ونتيجة كل فحص. لا `float` ولا تقريب ولا قسمة: كل جمع عبر `addExact` الذي يكتشف فيض `int` (PHP يحوّله إلى
 * `float` بصمت) ويعدّه فشلاً. حدّ كل مبلغ `MAX_SAFE_MINOR = 2^53 − 1` ليبقى تمثيله دقيقاً في وكلاء JavaScript.
 *
 * الفحوص الناجحة تعني اتساقاً داخلياً حسابياً فقط. لا تعني أن الكشف يطابق دفاتر الطرف أو المستندات
 * (`not_checked`)، ولا تُثبت صحة اتجاه الدور (المرجع: `balance_convention`).
 */
final class StatementIntegrity
{
    /** 2^53 − 1 = Number.MAX_SAFE_INTEGER. */
    public const MAX_SAFE_MINOR = 9007199254740991;

    public const CHECK_MINOR_INTEGERS = 'minor_units_are_integers';
    public const CHECK_NON_NEGATIVE = 'amounts_are_non_negative';
    public const CHECK_RUNNING_CHAIN = 'running_balance_chain';
    public const CHECK_CLOSING_EQUALS = 'closing_equals_opening_plus_net';
    public const CHECK_ROW_COUNT = 'row_count_matches_rows';

    /**
     * @param  array<int, array{debit:mixed, credit:mixed, balance:mixed}>  $rows  الصفوف كما أعادتها `ReportService::partnerStatement`
     * @param  int|null  $expectedRowCount  عدد الصفوف الذي يدّعيه المصدر (لمقارنته بما فُحص فعلاً)
     * @return array{
     *   totals: array{row_count:int, debit_minor:int, credit_minor:int, net_minor:int},
     *   checks: list<array{id:string, passed:bool}>,
     *   passed: bool,
     *   failed: list<string>
     * }
     */
    public static function evaluate(mixed $opening, array $rows, mixed $closing, ?int $expectedRowCount = null): array
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

        $totals = ['row_count' => count($rows), 'debit_minor' => 0, 'credit_minor' => 0, 'net_minor' => 0];
        $chain = $integers;
        $closingMatches = $integers;

        if ($integers) {
            $debitSum = 0;
            $creditSum = 0;
            $running = $opening;
            foreach ($rows as $row) {
                $debitSum = self::addExact($debitSum, $row['debit']);
                $creditSum = self::addExact($creditSum, $row['credit']);
                $running = self::addExact($running, self::addExact($row['debit'], -$row['credit']));
                if ($running !== $row['balance']) {
                    $chain = false;
                }
            }
            $net = ($debitSum === null || $creditSum === null) ? null : self::addExact($debitSum, -$creditSum);

            if ($debitSum === null || $creditSum === null || $net === null) {
                // فيض الجمع: الأرقام أكبر من أن تُمثَّل بدقة ⇒ فشل سلامة الأعداد لا تقريب.
                $integers = false;
                $chain = false;
                $closingMatches = false;
            } else {
                $totals['debit_minor'] = $debitSum;
                $totals['credit_minor'] = $creditSum;
                $totals['net_minor'] = $net;
                $expectedClosing = self::addExact($opening, $net);
                $closingMatches = $expectedClosing !== null && $expectedClosing === $closing;
            }
        }

        $checks = [
            ['id' => self::CHECK_MINOR_INTEGERS, 'passed' => $integers],
            ['id' => self::CHECK_NON_NEGATIVE, 'passed' => $integers && $nonNegative],
            ['id' => self::CHECK_RUNNING_CHAIN, 'passed' => $chain],
            ['id' => self::CHECK_CLOSING_EQUALS, 'passed' => $closingMatches],
            ['id' => self::CHECK_ROW_COUNT, 'passed' => $expectedRowCount === null || $expectedRowCount === count($rows)],
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

    /** جمع صحيح دقيق؛ `null` عند الفيض (لا تحويل صامت إلى float). */
    public static function addExact(?int $a, ?int $b): ?int
    {
        if ($a === null || $b === null) {
            return null;
        }
        $sum = $a + $b;

        return is_int($sum) ? $sum : null;
    }
}
