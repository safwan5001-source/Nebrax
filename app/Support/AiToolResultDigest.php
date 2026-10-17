<?php

namespace App\Support;

/**
 * ملخّص **محجوب ومقصوص** لنتيجة أداة مالية قبل إرساله إلى مزوّد خارجي (AI-07).
 *
 * المبدأ: للنموذج أن يرى الأرقام اللازمة للصياغة وحدها. لا يغادر الخادمَ: معرّفات الأطراف، أسماء الأطراف
 * (تُستبدل برموز `Party-N` ويُعاد ربطها **محلياً** بعد الجواب)، روابط المصادر، نطاق التفويض، معرّفات الفروع.
 * النتيجة الكاملة بأرقامها ومصادرها تبقى هي المرجع الوحيد للمستخدم في `tool_calls[].result`.
 *
 * أرقام الملخّص نصوص عشرية (SAR) بلا float. الصفوف مقصوصة بحدّ رموز صريح؛ ما قُصّ يُعلَن (`rows_omitted`).
 */
final class AiToolResultDigest
{
    private const ROW_STEPS = [20, 10, 5, 0];

    /**
     * @param  array<string,mixed>  $result  نتيجة أداة مالية كما تُعيدها `AiFinanceReportTool::execute`.
     * @return array{digest:array<string,mixed>, names:array<string,string>}
     */
    public static function build(array $result, int $maxTokens): array
    {
        foreach (self::ROW_STEPS as $rows) {
            [$digest, $names] = self::shape($result, $rows);
            if (self::estimateTokens($digest) <= $maxTokens || $rows === 0) {
                return ['digest' => $digest, 'names' => $names];
            }
        }

        return ['digest' => $digest, 'names' => $names]; // غير قابل للبلوغ؛ يُرضي المحلّل.
    }

    public static function estimateTokens(array $digest): int
    {
        return intdiv(strlen((string) json_encode($digest, JSON_UNESCAPED_UNICODE)) + 2, 3);
    }

    /** @return array{0:array<string,mixed>, 1:array<string,string>} */
    private static function shape(array $result, int $maxRows): array
    {
        $report = (string) ($result['report'] ?? '');
        $base = ['report' => $report, 'currency' => (string) ($result['currency'] ?? 'SAR'), 'timezone' => (string) ($result['timezone'] ?? '')];
        $money = static fn (mixed $m): string => is_array($m) ? (string) ($m['decimal'] ?? '0.00') : '0.00';

        if ($report === 'income_statement') {
            $line = static fn (array $r): array => ['code' => (string) $r['code'], 'name' => (string) $r['name'], 'amount' => $money($r['amount'] ?? null)];
            $cap = max($maxRows, 5);
            $revenues = array_values((array) ($result['revenues'] ?? []));
            $expenses = array_values((array) ($result['expenses'] ?? []));
            $digest = $base + [
                'period' => ['from' => (string) ($result['period']['from'] ?? ''), 'to' => (string) ($result['period']['to'] ?? ''), 'inclusive' => true],
                'totals' => [
                    'total_revenue' => $money($result['totals']['total_revenue'] ?? null),
                    'total_expense' => $money($result['totals']['total_expense'] ?? null),
                    'net_income' => $money($result['totals']['net_income'] ?? null),
                ],
                'revenues' => array_map($line, array_slice($revenues, 0, $cap)),
                'expenses' => array_map($line, array_slice($expenses, 0, $cap)),
                'lines_omitted' => max(0, count($revenues) - $cap) + max(0, count($expenses) - $cap),
            ];
            if (isset($result['unallocated'])) {
                $digest['unallocated_to_a_branch'] = [
                    'total_revenue' => $money($result['unallocated']['total_revenue'] ?? null),
                    'total_expense' => $money($result['unallocated']['total_expense'] ?? null),
                    'net_income' => $money($result['unallocated']['net_income'] ?? null),
                ];
            }

            return [$digest, []];
        }

        // أعمار الذمم المدينة/الدائنة.
        $buckets = static fn (array $r): array => [
            'b0_30' => $money($r['b0_30'] ?? null), 'b31_60' => $money($r['b31_60'] ?? null),
            'b61_90' => $money($r['b61_90'] ?? null), 'b90_plus' => $money($r['b90_plus'] ?? null), 'total' => $money($r['total'] ?? null),
        ];
        $rows = array_values((array) ($result['rows'] ?? []));
        usort($rows, static fn (array $a, array $b): int => (int) ($b['total']['minor'] ?? 0) <=> (int) ($a['total']['minor'] ?? 0));
        $names = [];
        $shaped = [];
        foreach (array_slice($rows, 0, $maxRows) as $i => $row) {
            $token = 'Party-' . ($i + 1);
            $names[$token] = (string) ($row['name'] ?? '');
            $shaped[] = ['party' => $token] + $buckets($row);
        }

        return [$base + [
            'as_of' => (string) ($result['as_of'] ?? ''),
            'note' => 'current outstanding balances; as_of only sets the age reference; b0_30 includes not-yet-due',
            'totals' => $buckets((array) ($result['totals'] ?? [])),
            'partner_detail' => (string) ($result['partner_detail'] ?? 'withheld'),
            'rows' => $shaped,
            'rows_omitted' => max(0, count($rows) - count($shaped)),
            'warnings' => array_values(array_map(static fn (array $w): string => (string) ($w['code'] ?? ''), (array) ($result['warnings'] ?? []))),
        ], $names];
    }
}
