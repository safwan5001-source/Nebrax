<?php

namespace Tests\Feature;

use App\Support\Money;
use App\Support\PartnerStatementEnvelope as Envelope;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * AIA-0.1 — الغلاف المتحقَّق: اتجاه الرصيد، نصوص العرض، حالة التقرير، وقرار العملات D-12 (SAR فقط). نقي بلا قاعدة بيانات.
 */
class PartnerStatementEnvelopeTest extends TestCase
{
    /** @param list<array{0:int,1:int}> $movements [debit, credit] */
    private function statement(string $type, int $opening, array $movements): array
    {
        $rows = [];
        $running = $opening;
        foreach ($movements as [$debit, $credit]) {
            $running += $debit - $credit;
            $rows[] = ['debit' => $debit, 'credit' => $credit, 'balance' => $running];
        }

        return ['partner' => ['id' => 'p', 'name' => 'x', 'type' => $type], 'opening_balance' => $opening, 'rows' => $rows, 'closing_balance' => $running];
    }

    #[Test]
    public function a_supplier_we_owe_is_payable_with_an_absolute_display(): void
    {
        // شراء 1,150.00 ثم دفع 500.00 ⇒ نحن مدينون بـ650.00.
        $e = Envelope::build($this->statement('supplier', 0, [[0, 115000], [50000, 0]]), 'supplier', 'SAR');

        $this->assertSame('final', $e['report_status']);
        $this->assertSame('verified', $e['integrity']['status']);
        $this->assertSame(2, $e['minor_unit_exponent']);
        $this->assertSame(2, $e['row_count']);
        $this->assertSame(['row_count' => 2, 'debit_minor' => 50000, 'credit_minor' => 115000, 'net_minor' => -65000], $e['totals']);
        $this->assertSame(['side' => 'payable', 'amount_minor' => 65000, 'opposite_sign' => false], $e['position']['closing']);
        $this->assertSame(['side' => 'settled', 'amount_minor' => 0, 'opposite_sign' => false], $e['position']['opening']);
        $this->assertSame([
            'currency' => 'SAR', 'minor_unit_exponent' => 2,
            'opening' => '0.00', 'opening_side' => 'settled',
            'debit' => '500.00', 'credit' => '1150.00', 'net' => '-650.00',
            'closing' => '650.00', 'closing_side' => 'payable',
        ], $e['display']);
        $this->assertSame(
            ['formula' => 'debit_minus_credit', 'positive_means' => 'partner_owes_us', 'negative_means' => 'we_owe_partner'],
            $e['balance_convention']
        );
    }

    #[Test]
    public function a_customer_who_owes_us_is_receivable(): void
    {
        $e = Envelope::build($this->statement('customer', 0, [[115000, 0]]), 'customer', 'SAR');

        $this->assertSame('receivable', $e['position']['closing']['side']);
        $this->assertFalse($e['position']['closing']['opposite_sign']);
        $this->assertSame('1150.00', $e['display']['closing']);
        $this->assertSame('receivable', $e['display']['closing_side']);
    }

    #[Test]
    public function opposite_sign_is_flagged_for_a_credit_customer_and_a_debit_supplier(): void
    {
        $customerInCredit = Envelope::build($this->statement('customer', 0, [[0, 5000]]), 'customer', 'SAR');
        $this->assertSame('payable', $customerInCredit['position']['closing']['side']);
        $this->assertTrue($customerInCredit['position']['closing']['opposite_sign']);

        $supplierInDebit = Envelope::build($this->statement('supplier', 0, [[5000, 0]]), 'supplier', 'SAR');
        $this->assertSame('receivable', $supplierInDebit['position']['closing']['side']);
        $this->assertTrue($supplierInDebit['position']['closing']['opposite_sign']);
    }

    #[Test]
    public function the_expected_role_falls_back_to_the_partner_type_and_is_unknown_for_both(): void
    {
        $supplier = Envelope::build($this->statement('supplier', 0, [[5000, 0]]), null, 'SAR');
        $this->assertTrue($supplier['position']['closing']['opposite_sign'], 'بلا role يُستنتج الدور من نوع الطرف.');

        $both = Envelope::build($this->statement('both', 0, [[5000, 0]]), null, 'SAR');
        $this->assertFalse($both['position']['closing']['opposite_sign'], 'ثنائي الدور بلا role: لا دور متوقعاً فلا علم.');
        $this->assertNull($both['role']);
    }

    #[Test]
    public function a_non_zero_opening_has_its_own_side_and_the_closing_reconciles(): void
    {
        $e = Envelope::build($this->statement('supplier', -40000, [[10000, 0]]), 'supplier', 'SAR');

        $this->assertSame('payable', $e['position']['opening']['side']);
        $this->assertSame(40000, $e['position']['opening']['amount_minor']);
        $this->assertSame('400.00', $e['display']['opening']);
        $this->assertSame('payable', $e['display']['opening_side']);
        $this->assertSame('300.00', $e['display']['closing']);
    }

    #[Test]
    public function an_empty_statement_is_final_and_settled(): void
    {
        $e = Envelope::build($this->statement('supplier', 0, []), 'supplier', 'SAR');

        $this->assertSame('final', $e['report_status']);
        $this->assertSame(0, $e['row_count']);
        $this->assertSame('settled', $e['position']['closing']['side']);
        $this->assertSame('0.00', $e['display']['net']);
    }

    #[Test]
    public function display_strings_are_exactly_money_to_riyal(): void
    {
        foreach ([1, 9, 10, 99, 100, 101, 123456789, 586086, 1900000] as $minor) {
            $e = Envelope::build($this->statement('customer', 0, [[$minor, 0]]), 'customer', 'SAR');
            $this->assertSame(Money::toRiyal($minor), $e['display']['closing']);
            $this->assertMatchesRegularExpression('/^\d+\.\d{2}$/', $e['display']['closing'], 'أرقام 0–9 ونقطة عشرية بلا فاصل آلاف.');
        }
        $e = Envelope::build($this->statement('supplier', 0, [[0, 65000]]), 'supplier', 'SAR');
        $this->assertSame('-650.00', $e['display']['net']);
        $this->assertSame('650.00', $e['display']['closing']);
    }

    #[Test]
    public function a_sar_code_in_any_case_is_supported_and_displayed_canonically(): void
    {
        $e = Envelope::build($this->statement('customer', 0, [[100, 0]]), ' sar ', 'sar');
        $this->assertSame('final', $e['report_status']);
        $this->assertSame('SAR', $e['display']['currency']);
    }

    public static function unsupportedCurrencies(): array
    {
        return [['KWD'], ['JPY'], ['BHD'], ['USD'], ['XYZ'], [''], [null]];
    }

    #[Test]
    #[DataProvider('unsupportedCurrencies')]
    public function an_unsupported_currency_is_never_final_and_has_no_display(mixed $currency): void
    {
        $e = Envelope::build($this->statement('customer', 0, [[115000, 0]]), 'customer', $currency);

        $this->assertSame('unsupported', $e['report_status']);
        $this->assertSame('unsupported', $e['integrity']['status']);
        $this->assertSame('currency_exponent_unsupported', $e['integrity']['reason']);
        $this->assertNull($e['display']);
        $this->assertNull($e['position']);
        $this->assertNull($e['minor_unit_exponent']);
        $this->assertSame(115000, $e['totals']['debit_minor'], 'الإجماليات الخام تبقى للتوافق.');
    }

    #[Test]
    public function a_failed_check_makes_the_report_unverified_and_withholds_display_and_position(): void
    {
        $statement = $this->statement('customer', 0, [[100, 0], [0, 30]]);
        $statement['rows'][1]['balance'] = 999;

        $e = Envelope::build($statement, 'customer', 'SAR');

        $this->assertSame('unverified', $e['report_status']);
        $this->assertSame('failed', $e['integrity']['status']);
        $this->assertSame(['running_balance_chain'], $e['integrity']['failed_checks']);
        $this->assertNull($e['display']);
        $this->assertNull($e['position']);
    }

    #[Test]
    public function an_incomplete_result_is_partial_never_final(): void
    {
        $e = Envelope::build($this->statement('customer', 0, [[100, 0]]), 'customer', 'SAR', complete: false);

        $this->assertSame('partial', $e['report_status']);
        $this->assertSame('verified', $e['integrity']['status']);
    }

    #[Test]
    public function final_is_only_ever_produced_with_all_checks_passing_and_a_supported_currency(): void
    {
        $good = $this->statement('customer', 0, [[100, 0]]);
        $bad = $good;
        $bad['closing_balance'] = 7;

        foreach ([['SAR', $good, true, 'final'], ['SAR', $bad, true, 'unverified'], ['SAR', $good, false, 'partial'], ['KWD', $good, true, 'unsupported']] as [$cur, $st, $complete, $expect]) {
            $this->assertSame($expect, Envelope::build($st, null, $cur, $complete)['report_status']);
        }
    }

    #[Test]
    public function the_integrity_block_always_declares_what_it_does_not_check(): void
    {
        $e = Envelope::build($this->statement('customer', 0, []), null, 'SAR');

        $this->assertContains('source_documents_reconciliation', $e['integrity']['not_checked']);
        $this->assertContains('role_attribution_independent_verification', $e['integrity']['not_checked']);
        $this->assertContains('completeness_independent_verification', $e['integrity']['not_checked'], 'الاكتمال المستقل مؤجَّل إلى AIA-0.2 ولا يُدّعى.');
    }

    #[Test]
    public function totals_beyond_the_safe_range_make_the_report_unverified_with_no_partial_totals(): void
    {
        // حركات متوازنة متكررة: كل حركة والرصيد الجاري آمنان، وإجمالي كل جانب يتجاوز 2^53−1 دون تجاوز PHP_INT_MAX.
        $x = 4503599627370496;
        $e = Envelope::build($this->statement('customer', 0, [[$x, 0], [0, $x], [$x, 0], [0, $x], [$x, 0], [0, $x]]), 'customer', 'SAR', emittedRowCount: 6);

        $this->assertSame('unverified', $e['report_status']);
        $this->assertSame('failed', $e['integrity']['status']);
        $this->assertContains('computed_values_within_safe_range', $e['integrity']['failed_checks']);
        $this->assertNull($e['display']);
        $this->assertNull($e['position']);
        $this->assertNull($e['totals']['debit_minor']);
        $this->assertNull($e['totals']['credit_minor']);
        $this->assertNull($e['totals']['net_minor']);
        $this->assertSame(6, $e['totals']['row_count']);
        $this->assertSame(6, $e['row_count']);
    }

    #[Test]
    public function the_emitted_row_count_is_compared_but_is_not_an_independent_completeness_proof(): void
    {
        $st = $this->statement('customer', 0, [[100, 0], [0, 30]]);

        $this->assertSame('final', Envelope::build($st, null, 'SAR', emittedRowCount: 2)['report_status']);
        $mismatch = Envelope::build($st, null, 'SAR', emittedRowCount: 1);
        $this->assertSame('unverified', $mismatch['report_status']);
        $this->assertSame(['row_count_matches_rows'], $mismatch['integrity']['failed_checks']);
    }
}
