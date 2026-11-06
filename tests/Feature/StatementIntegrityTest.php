<?php

namespace Tests\Feature;

use App\Support\StatementIntegrity;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * AIA-0.1 — فحوص السلامة النقية: إجماليات من الصفوف الأصلية بأعداد صحيحة، وفشل مغلق عند أي خلل.
 */
class StatementIntegrityTest extends TestCase
{
    /** @return list<array{debit:int, credit:int, balance:int}> */
    private function chain(int $opening, array $movements): array
    {
        $rows = [];
        $running = $opening;
        foreach ($movements as [$debit, $credit]) {
            $running += $debit - $credit;
            $rows[] = ['debit' => $debit, 'credit' => $credit, 'balance' => $running];
        }

        return $rows;
    }

    #[Test]
    public function the_supplier_example_totals_come_from_the_rows(): void
    {
        $rows = $this->chain(0, [[0, 115000], [50000, 0]]);
        $r = StatementIntegrity::evaluate(0, $rows, -65000, 2);

        $this->assertTrue($r['passed']);
        $this->assertSame(['row_count' => 2, 'debit_minor' => 50000, 'credit_minor' => 115000, 'net_minor' => -65000], $r['totals']);
        $this->assertSame([], $r['failed']);
    }

    #[Test]
    public function an_empty_statement_is_consistent_only_when_closing_equals_opening(): void
    {
        $this->assertTrue(StatementIntegrity::evaluate(500, [], 500, 0)['passed']);
        $this->assertSame(['closing_equals_opening_plus_net'], StatementIntegrity::evaluate(500, [], 600, 0)['failed']);
    }

    #[Test]
    public function the_reported_baseline_values_reconcile(): void
    {
        // القيم المُبلَّغة من باشت (غير متحقَّق منها من الإنتاج): ثلاث قيم لكل جانب بالهللات.
        $amounts = [586086, 608511, 705403];
        $movements = [];
        foreach ($amounts as $a) {
            $movements[] = [0, $a];
            $movements[] = [$a, 0];
        }
        $r = StatementIntegrity::evaluate(0, $this->chain(0, $movements), 0, 6);

        $this->assertTrue($r['passed']);
        $this->assertSame(1900000, $r['totals']['debit_minor']);
        $this->assertSame(1900000, $r['totals']['credit_minor']);
        $this->assertSame(0, $r['totals']['net_minor']);
        $this->assertSame(6, $r['totals']['row_count']);
    }

    #[Test]
    public function a_broken_running_balance_chain_is_detected(): void
    {
        $rows = $this->chain(0, [[100, 0], [0, 30]]);
        $rows[1]['balance'] = 71; // الصحيح 70
        $r = StatementIntegrity::evaluate(0, $rows, 70, 2);

        $this->assertFalse($r['passed']);
        $this->assertSame(['running_balance_chain'], $r['failed']);
    }

    #[Test]
    public function a_closing_balance_that_disagrees_with_opening_plus_net_is_detected(): void
    {
        $r = StatementIntegrity::evaluate(0, $this->chain(0, [[100, 0]]), 101, 1);

        $this->assertSame(['closing_equals_opening_plus_net'], $r['failed']);
    }

    #[Test]
    public function an_opening_balance_that_is_not_the_chain_origin_is_detected(): void
    {
        // الصف الأول مبني على افتتاحي 0 بينما المُعلَن 10 ⇒ السلسلة تنكسر.
        $r = StatementIntegrity::evaluate(10, $this->chain(0, [[100, 0]]), 110, 1);

        $this->assertContains('running_balance_chain', $r['failed']);
    }

    #[Test]
    public function a_row_count_mismatch_is_detected(): void
    {
        $r = StatementIntegrity::evaluate(0, $this->chain(0, [[100, 0]]), 100, 2);

        $this->assertSame(['row_count_matches_rows'], $r['failed']);
    }

    #[Test]
    public function negative_debit_or_credit_is_detected(): void
    {
        $rows = [['debit' => -5, 'credit' => 0, 'balance' => -5]];
        $r = StatementIntegrity::evaluate(0, $rows, -5, 1);

        $this->assertContains('amounts_are_non_negative', $r['failed']);
    }

    #[Test]
    public function non_integer_values_are_never_coerced(): void
    {
        foreach ([115.0, '115', 115.5, null, true] as $bad) {
            $rows = [['debit' => $bad, 'credit' => 0, 'balance' => 115]];
            $r = StatementIntegrity::evaluate(0, $rows, 115, 1);
            $this->assertFalse($r['passed'], 'القيمة '.var_export($bad, true).' يجب أن تُرفض.');
            $this->assertContains('minor_units_are_integers', $r['failed']);
        }

        $this->assertContains('minor_units_are_integers', StatementIntegrity::evaluate('0', [], 0, 0)['failed']);
        $this->assertContains('minor_units_are_integers', StatementIntegrity::evaluate(0, [], 0.0, 0)['failed']);
    }

    #[Test]
    public function amounts_beyond_the_javascript_safe_range_fail_integrity(): void
    {
        $limit = StatementIntegrity::MAX_SAFE_MINOR;
        $this->assertSame(9007199254740991, $limit);

        $ok = StatementIntegrity::evaluate(0, $this->chain(0, [[$limit, 0]]), $limit, 1);
        $this->assertTrue($ok['passed']);
        $this->assertSame($limit, $ok['totals']['debit_minor']);

        $over = $limit + 1;
        $r = StatementIntegrity::evaluate(0, [['debit' => $over, 'credit' => 0, 'balance' => $over]], $over, 1);
        $this->assertContains('minor_units_are_integers', $r['failed']);
    }

    #[Test]
    public function integer_overflow_during_summation_fails_instead_of_degrading_to_float(): void
    {
        // كل مبلغ داخل النطاق الآمن لكن مجموع 1500 صف يتجاوز PHP_INT_MAX ⇒ يجب الفشل لا التحويل إلى float.
        $limit = StatementIntegrity::MAX_SAFE_MINOR;
        $rows = [];
        $running = 0;
        for ($i = 0; $i < 1500; $i++) {
            // مدين ثم دائن بالقدر نفسه يُبقي الرصيد الجاري صغيراً بينما تتضخم الإجماليات.
            $rows[] = ['debit' => $limit, 'credit' => 0, 'balance' => $running + $limit];
            $rows[] = ['debit' => 0, 'credit' => $limit, 'balance' => $running];
        }
        $r = StatementIntegrity::evaluate(0, $rows, 0, 3000);

        $this->assertFalse($r['passed']);
        $this->assertContains('minor_units_are_integers', $r['failed']);
        $this->assertSame(0, $r['totals']['debit_minor'], 'لا إجمالي جزئي مضلّل عند الفشل.');
        foreach ($r['totals'] as $v) {
            $this->assertIsInt($v);
        }
    }

    #[Test]
    public function sums_near_the_safe_limit_stay_exact(): void
    {
        $a = 9007199254740000; // أقل من 2^53 − 1 بقليل: دقيق ومُمثَّل تماماً
        $rows = $this->chain(0, [[$a, 0], [0, $a - 1]]);
        $r = StatementIntegrity::evaluate(0, $rows, 1, 2);

        $this->assertTrue($r['passed']);
        $this->assertSame($a, $r['totals']['debit_minor']);
        $this->assertSame($a - 1, $r['totals']['credit_minor']);
        $this->assertSame(1, $r['totals']['net_minor']);
    }
}
