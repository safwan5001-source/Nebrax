<?php

namespace Tests\Feature;

use App\Services\PartnerStatementMatchingEngine;
use PHPUnit\Framework\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A2c — المحرك الحتمي النقي (بلا قاعدة بيانات): القواعد R1–R3 والنتائج الخمس والتسامحات والحدود والاستعمال المزدوج والانعكاس وmany-to-one اقتراحاً.
 * تشغيل: php artisan test --filter=PartnerStatementMatchingEngineTest
 */
class PartnerStatementMatchingEngineTest extends TestCase
{
    private PartnerStatementMatchingEngine $engine;

    protected function setUp(): void
    {
        parent::setUp();
        $this->engine = new PartnerStatementMatchingEngine();
    }

    // ═══════════════════════════════ أدوات ═══════════════════════════════

    /** سطر كشف (منظور الطرف المقابل). */
    private function line(int $ordinal, string $date, int $debit = 0, int $credit = 0, string $ref = '', string $our = '', ?string $kind = null): array
    {
        return [
            'id' => 'line-'.$ordinal, 'ordinal' => $ordinal, 'date' => $date, 'reference_key' => strtolower($ref), 'our_reference_key' => strtolower($our),
            'debit_minor' => $debit, 'credit_minor' => $credit, 'kind' => $kind,
        ];
    }

    /** وحدة دفترية: الاتجاه والمبلغ بمنظورنا. */
    private function unit(string $key, string $kind, string $number, string $date, string $direction, int $amount, string $state = 'active', bool $inPeriod = true, string $external = '', array $reasons = []): array
    {
        $net = $direction === 'debit' ? $amount : ($direction === 'credit' ? -$amount : 0);

        return [
            'key' => $key, 'kind' => $kind, 'source_id' => $key, 'label' => null, 'numbers' => ['JE-'.$key], 'entry_ids' => ['e-'.$key], 'date' => $date, 'last_date' => $date,
            'in_period' => $inPeriod, 'debit_minor' => $direction === 'debit' ? $amount : 0, 'credit_minor' => $direction === 'credit' ? $amount : 0, 'net_minor' => $net,
            'direction' => $direction, 'state' => $state, 'matchable' => $state === 'active', 'reasons' => $reasons,
            'doc' => ['number' => $number, 'number_key' => strtolower($number), 'external_key' => strtolower($external)],
        ];
    }

    private function go(array $lines, array $units, int $dateTol = 3, int $amountTol = 0, string $role = 'customer'): array
    {
        return $this->engine->match($lines, $units, ['date_tolerance_days' => $dateTol, 'amount_tolerance_minor' => $amountTol], $role);
    }

    /** @return array<int, array<string, mixed>> نتائج جهة الكشف بمفتاح رقم الصف */
    private function byLine(array $result): array
    {
        $out = [];
        foreach ($result['statement'] as $row) {
            $out[$row['ordinal']] = $row;
        }

        return $out;
    }

    /** @return array<string, array<string, mixed>> نتائج جهة الدفتر بمفتاح الوحدة */
    private function byUnit(array $result): array
    {
        $out = [];
        foreach ($result['ledger'] as $row) {
            $out[$row['unit_key']] = $row;
        }

        return $out;
    }

    // ═══════════════════════════════ R1 / R2 ═══════════════════════════════

    /** @test */
    public function r1_matches_by_our_reference_with_the_mirrored_direction(): void
    {
        // فاتورتنا للعميل: مدين عندنا ١٠٠٠؛ في كشفه دائن ١٠٠٠.
        $result = $this->go([$this->line(2, '2026-09-01', credit: 100000, our: 'inv-1')], [$this->unit('u1', 'invoice', 'INV-1', '2026-09-01', 'debit', 100000)]);
        $row = $this->byLine($result)[2];

        $this->assertSame(['matched', 'R1', 'matched_by_our_reference', 'u1', 0, 0], [$row['outcome'], $row['rule'], $row['explanation']['code'], $row['unit_key'], $row['difference_minor'], $row['day_difference']]);
        $this->assertSame(['matched', 2], [$this->byUnit($result)['u1']['outcome'], $this->byUnit($result)['u1']['ordinal']]);
    }

    /** @test */
    public function the_ladder_is_first_hit_wins_r1_before_r2_before_r3(): void
    {
        $units = [
            $this->unit('a', 'invoice', 'INV-A', '2026-09-01', 'debit', 100000),
            $this->unit('b', 'invoice', 'INV-B', '2026-09-01', 'debit', 100000),
            $this->unit('c', 'invoice', 'INV-C', '2026-09-01', 'debit', 100000),
        ];
        // our_reference يصيب a، reference يصيب b، والمبلغ/التاريخ يصيبان الثلاث: R1 تحسم.
        $row = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 100000, ref: 'inv-b', our: 'inv-a')], $units))[2];
        $this->assertSame(['R1', 'a'], [$row['rule'], $row['unit_key']]);

        // بلا R1: R2 (reference) تحسم قبل R3.
        $row = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 100000, ref: 'inv-b')], $units))[2];
        $this->assertSame(['R2', 'b', 'matched_by_reference'], [$row['rule'], $row['unit_key'], $row['explanation']['code']]);
    }

    /** @test */
    public function r2_uses_the_supplier_invoice_number_for_purchases_and_the_document_number_otherwise(): void
    {
        $purchase = $this->unit('p1', 'purchase', 'BILL-9', '2026-09-02', 'credit', 50000, external: 'SUP-77');
        // كشف المورد: مدين ٥٠٠ (فاتورته). reference = رقم فاتورة المورد عندنا.
        $hit = $this->byLine($this->go([$this->line(2, '2026-09-02', debit: 50000, ref: 'sup-77')], [$purchase], role: 'supplier'))[2];
        $this->assertSame(['matched', 'R2', 'p1'], [$hit['outcome'], $hit['rule'], $hit['unit_key']]);

        // رقم الشراء الداخلي ليس نظير R2 للمشتريات (لا يصيب بـreference)؛ يسقط إلى R3 ويُطابَق بالمبلغ والتاريخ فقط.
        $viaR3 = $this->byLine($this->go([$this->line(2, '2026-09-02', debit: 50000, ref: 'bill-9')], [$purchase], role: 'supplier'))[2];
        $this->assertSame(['matched', 'R3'], [$viaR3['outcome'], $viaR3['rule']]);

        // غير المشتريات: reference = رقم المستند.
        $sales = $this->unit('i1', 'invoice', 'INV-5', '2026-09-02', 'debit', 50000);
        $this->assertSame('R2', $this->byLine($this->go([$this->line(2, '2026-09-02', credit: 50000, ref: 'inv-5')], [$sales]))[2]['rule']);
    }

    // ═══════════════════════════════ الفروق والتسامحات ═══════════════════════════════

    /** @test */
    public function amount_tolerance_is_inclusive_and_a_larger_gap_is_an_amount_difference_with_a_signed_value(): void
    {
        $unit = $this->unit('u1', 'invoice', 'INV-1', '2026-09-01', 'debit', 100000);

        $atEdge = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 100010, our: 'inv-1')], [$unit], amountTol: 10))[2];
        $this->assertSame(['matched', 10], [$atEdge['outcome'], $atEdge['difference_minor']]);

        $over = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 100011, our: 'inv-1')], [$unit], amountTol: 10))[2];
        $this->assertSame(['amount_difference', 'amount_differs', 11, 'R1'], [$over['outcome'], $over['explanation']['code'], $over['difference_minor'], $over['rule']]);

        $under = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 99000, our: 'inv-1')], [$unit]))[2];
        $this->assertSame(['amount_difference', -1000], [$under['outcome'], $under['difference_minor']]);
        $this->assertSame('needs_review', $this->byUnit($this->go([$this->line(2, '2026-09-01', credit: 99000, our: 'inv-1')], [$unit]))['u1']['outcome'], 'الوحدة مرتبطة بفرق فلا تُعدّ مفقودة.');
    }

    /** @test */
    public function date_tolerance_is_inclusive_and_a_larger_gap_is_a_date_difference(): void
    {
        $unit = $this->unit('u1', 'invoice', 'INV-1', '2026-09-10', 'debit', 100000);

        $edgeLater = $this->byLine($this->go([$this->line(2, '2026-09-13', credit: 100000, our: 'inv-1')], [$unit], dateTol: 3))[2];
        $this->assertSame(['matched', 3], [$edgeLater['outcome'], $edgeLater['day_difference']]);
        $edgeEarlier = $this->byLine($this->go([$this->line(2, '2026-09-07', credit: 100000, our: 'inv-1')], [$unit], dateTol: 3))[2];
        $this->assertSame(['matched', -3], [$edgeEarlier['outcome'], $edgeEarlier['day_difference']]);

        $over = $this->byLine($this->go([$this->line(2, '2026-09-14', credit: 100000, our: 'inv-1')], [$unit], dateTol: 3))[2];
        $this->assertSame(['date_difference', 'date_differs', 4, 0], [$over['outcome'], $over['explanation']['code'], $over['day_difference'], $over['difference_minor']]);

        $zero = $this->byLine($this->go([$this->line(2, '2026-09-11', credit: 100000, our: 'inv-1')], [$unit], dateTol: 0))[2];
        $this->assertSame('date_difference', $zero['outcome'], 'تسامح صفري: يوم واحد فرق.');
    }

    /** @test */
    public function an_amount_difference_wins_over_a_date_difference_and_the_wrong_direction_is_flagged(): void
    {
        $unit = $this->unit('u1', 'invoice', 'INV-1', '2026-09-01', 'debit', 100000);
        $both = $this->byLine($this->go([$this->line(2, '2026-09-20', credit: 90000, our: 'inv-1')], [$unit]))[2];
        $this->assertSame(['amount_difference', 'amount_differs'], [$both['outcome'], $both['explanation']['code']]);

        // نفس المفتاح لكن باتجاه الكشف المدين (يُفترض دائن): لا تطابق؛ فرق بسبب الاتجاه.
        $wrong = $this->byLine($this->go([$this->line(2, '2026-09-01', debit: 100000, our: 'inv-1')], [$unit]))[2];
        $this->assertSame(['amount_difference', 'direction_mismatch', true], [$wrong['outcome'], $wrong['explanation']['code'], $wrong['explanation']['params']['direction_mismatch']]);
        $this->assertSame(200000, $wrong['difference_minor']);
    }

    // ═══════════════════════════════ R3 والغموض والاستعمال المزدوج ═══════════════════════════════

    /** @test */
    public function r3_matches_only_when_unique_on_both_sides(): void
    {
        $single = $this->go([$this->line(2, '2026-09-02', credit: 70000)], [$this->unit('u1', 'invoice', 'INV-1', '2026-09-01', 'debit', 70000)]);
        $row = $this->byLine($single)[2];
        $this->assertSame(['matched', 'R3', 'matched_by_amount_date_unique', 1], [$row['outcome'], $row['rule'], $row['explanation']['code'], $row['day_difference']]);

        // مرشحان لسطر واحد ⇒ ambiguous، والوحدتان تحتاجان مراجعة لا «مفقودة».
        $units = [$this->unit('u1', 'invoice', 'INV-1', '2026-09-01', 'debit', 70000), $this->unit('u2', 'invoice', 'INV-2', '2026-09-02', 'debit', 70000)];
        $result = $this->go([$this->line(2, '2026-09-02', credit: 70000)], $units);
        $row = $this->byLine($result)[2];
        $this->assertSame(['ambiguous', 'R3', 'ambiguous_multiple_candidates', ['u1', 'u2']], [$row['outcome'], $row['rule'], $row['explanation']['code'], array_column($row['candidates'], 'key')]);
        $this->assertSame(['needs_review', 'needs_review'], [$this->byUnit($result)['u1']['outcome'], $this->byUnit($result)['u2']['outcome']]);
    }

    /** @test */
    public function a_unit_wanted_by_two_lines_is_never_assigned_to_either(): void
    {
        $unit = $this->unit('u1', 'invoice', 'INV-1', '2026-09-02', 'debit', 70000);

        // R3: سطران متماثلان لوحدة واحدة.
        $r3 = $this->go([$this->line(2, '2026-09-02', credit: 70000), $this->line(3, '2026-09-03', credit: 70000)], [$unit]);
        $rows = $this->byLine($r3);
        $this->assertSame(['ambiguous', 'ambiguous'], [$rows[2]['outcome'], $rows[3]['outcome']]);
        $this->assertSame('unit_claimed_by_several_lines', $rows[2]['explanation']['code']);
        $this->assertSame('needs_review', $this->byUnit($r3)['u1']['outcome']);

        // R1: السطران يذكران رقم الفاتورة نفسه (تكرار في الكشف).
        $r1 = $this->go([$this->line(2, '2026-09-02', credit: 70000, our: 'inv-1'), $this->line(3, '2026-09-02', credit: 70000, our: 'inv-1')], [$unit]);
        $this->assertSame(['ambiguous', 'ambiguous', 'R1'], [$this->byLine($r1)[2]['outcome'], $this->byLine($r1)[3]['outcome'], $this->byLine($r1)[2]['rule']]);
        $this->assertNotContains('matched', array_column($r1['ledger'], 'outcome'));
    }

    /**
     * Codex #1908 P2: وحدات مرشّحة لمرجع غامض (مفتاح يصيب أكثر من وثيقة) لا تُعرَض على R3 لسطر آخر — وإلا طُوبق سطر بلا مرجع تلقائياً بوحدة ما زالت مطلوبة من سطر غامض.
     *
     * @test
     */
    public function units_in_a_key_ambiguity_are_not_offered_to_r3_for_other_lines(): void
    {
        // رقم واحد INV-1 لوثيقتين (فرعان): مبلغ ١٠٠ ومبلغ ٢٠٠.
        $units = [$this->unit('a', 'invoice', 'INV-1', '2026-09-01', 'debit', 10000), $this->unit('b', 'invoice', 'INV-1', '2026-09-01', 'debit', 20000)];
        $result = $this->go([
            $this->line(2, '2026-09-01', credit: 10000, our: 'inv-1'),   // يصيب الوثيقتين ⇒ ambiguous
            $this->line(3, '2026-09-01', credit: 10000),                 // بلا مرجع: يجب ألا يلتقط وحدة a
        ], $units);
        $rows = $this->byLine($result);

        $this->assertSame(['ambiguous', 'ambiguous_multiple_documents_for_reference'], [$rows[2]['outcome'], $rows[2]['explanation']['code']]);
        $this->assertSame('missing_in_books', $rows[3]['outcome'], 'لا تعيين تلقائي لوحدة مطلوبة من سطر غامض.');
        $this->assertNotContains('matched', array_column($result['statement'], 'outcome'));
        $this->assertSame(['needs_review', 'needs_review'], array_column($result['ledger'], 'outcome'));
    }

    /**
     * Codex #1908 P2 (الثانية): سطر مرجعه يصيب وثيقتين (غامض) **يطلب** وحدتيهما في كشف التعارض؛ سطر آخر يصيب إحداهما بمفتاح آخر (R2) لا يُسند له بصمت.
     *
     * @test
     */
    public function an_ambiguous_key_line_still_wants_its_units_so_a_competing_key_match_is_not_assigned(): void
    {
        // مشتريان بالرقم الداخلي BILL-1 في فرعين، بمرجعي مورد مختلفين.
        $units = [
            $this->unit('pa', 'purchase', 'BILL-1', '2026-09-01', 'credit', 10000, external: 'SUP-A'),
            $this->unit('pb', 'purchase', 'BILL-1', '2026-09-01', 'credit', 10000, external: 'SUP-B'),
        ];
        $result = $this->go([
            $this->line(2, '2026-09-01', debit: 10000, our: 'bill-1'),    // R1 يصيب الاثنين ⇒ غامض
            $this->line(3, '2026-09-01', debit: 10000, ref: 'sup-a'),     // R2 يصيب pa وحدها
        ], $units, role: 'supplier');
        $rows = $this->byLine($result);

        $this->assertSame(['ambiguous', 'ambiguous_multiple_documents_for_reference'], [$rows[2]['outcome'], $rows[2]['explanation']['code']]);
        $this->assertSame(['ambiguous', 'unit_claimed_by_several_lines', 'R2'], [$rows[3]['outcome'], $rows[3]['explanation']['code'], $rows[3]['rule']]);
        $this->assertNotContains('matched', array_column($result['statement'], 'outcome'));
        $this->assertSame(['needs_review', 'needs_review'], array_column($result['ledger'], 'outcome'));
    }

    /** @test */
    public function a_unit_matched_by_a_key_is_not_reused_by_r3_for_another_line(): void
    {
        $unit = $this->unit('u1', 'invoice', 'INV-1', '2026-09-02', 'debit', 70000);
        $result = $this->go([
            $this->line(2, '2026-09-02', credit: 70000, our: 'inv-1'),   // R1
            $this->line(3, '2026-09-02', credit: 70000),                 // نفس المبلغ والتاريخ بلا مفتاح
        ], [$unit]);
        $rows = $this->byLine($result);

        $this->assertSame(['matched', 'missing_in_books'], [$rows[2]['outcome'], $rows[3]['outcome']], 'الوحدة محجوزة للمطابقة بالمفتاح فلا يعاد استعمالها.');
    }

    /** @test */
    public function several_documents_for_one_reference_are_ambiguous(): void
    {
        $units = [$this->unit('u1', 'invoice', 'DUP-1', '2026-09-01', 'debit', 10000), $this->unit('u2', 'credit_note', 'DUP-1', '2026-09-01', 'debit', 10000)];
        $row = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 10000, our: 'dup-1')], $units))[2];

        $this->assertSame(['ambiguous', 'ambiguous_multiple_documents_for_reference', 'R1'], [$row['outcome'], $row['explanation']['code'], $row['rule']]);
        $this->assertSame(['u1', 'u2'], array_column($row['candidates'], 'key'));
    }

    // ═══════════════════════════════ الانعكاس ═══════════════════════════════

    /** @test */
    public function neutralised_and_incomplete_units_are_never_auto_matched(): void
    {
        $units = [
            $this->unit('n1', 'invoice', 'INV-N', '2026-09-01', 'none', 0, state: 'neutralised'),
            $this->unit('x1', 'invoice', 'INV-X', '2026-09-01', 'debit', 40000, state: 'incomplete', reasons: ['reversal_outside_window']),
        ];
        $result = $this->go([
            $this->line(2, '2026-09-01', credit: 90000, our: 'inv-n'),   // مفتاح وحدة معكوسة
            $this->line(3, '2026-09-01', credit: 40000, our: 'inv-x'),   // مفتاح وحدة ناقصة السلسلة
            $this->line(4, '2026-09-01', credit: 40000),                 // بلا مفتاح: R3 لا تلتقط الناقصة
        ], $units);
        $rows = $this->byLine($result);

        $this->assertSame(['amount_difference', 'reversed_in_books', 90000], [$rows[2]['outcome'], $rows[2]['explanation']['code'], $rows[2]['difference_minor']]);
        $this->assertSame(['ambiguous', 'candidate_reversal_incomplete', ['reversal_outside_window']], [$rows[3]['outcome'], $rows[3]['explanation']['code'], $rows[3]['explanation']['params']['reasons']]);
        $this->assertSame('missing_in_books', $rows[4]['outcome']);
        $this->assertNotContains('matched', array_column($result['statement'], 'outcome'));
        $by = $this->byUnit($result);
        $this->assertSame(['neutralised', 'incomplete'], [$by['n1']['outcome'], $by['x1']['outcome']]);
    }

    // ═══════════════════════════════ المفقود والحدود ═══════════════════════════════

    /** @test */
    public function missing_in_books_and_missing_in_statement_respect_the_period_boundary(): void
    {
        $units = [
            $this->unit('in', 'invoice', 'INV-IN', '2026-09-05', 'debit', 10000),
            $this->unit('out', 'invoice', 'INV-OUT', '2026-08-30', 'debit', 20000, inPeriod: false),   // داخل نافذة التسامح فقط
        ];
        $result = $this->go([$this->line(2, '2026-09-20', credit: 55555)], $units);

        $this->assertSame('missing_in_books', $this->byLine($result)[2]['outcome']);
        $by = $this->byUnit($result);
        $this->assertSame('missing_in_statement', $by['in']['outcome']);
        $this->assertArrayNotHasKey('out', $by, 'وحدة خارج الفترة لا تُعدّ مفقودة من الكشف.');
        $this->assertSame(['ledger.missing_in_statement' => 1, 'statement.missing_in_books' => 1], $result['counts']);
    }

    /** @test */
    public function a_candidate_outside_the_period_can_still_be_matched_inside_the_tolerance_window(): void
    {
        $unit = $this->unit('out', 'invoice', 'INV-OUT', '2026-08-30', 'debit', 20000, inPeriod: false);
        $row = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 20000)], [$unit]))[2];

        $this->assertSame(['matched', 2], [$row['outcome'], $row['day_difference']]);
    }

    // ═══════════════════════════════ many-to-one اقتراحاً ═══════════════════════════════

    /** @test */
    public function many_to_one_is_only_suggested_never_applied(): void
    {
        $units = [
            $this->unit('a', 'invoice', 'INV-A', '2026-09-01', 'debit', 30000),
            $this->unit('b', 'invoice', 'INV-B', '2026-09-02', 'debit', 45000),
            $this->unit('c', 'invoice', 'INV-C', '2026-09-03', 'debit', 99999),
        ];
        $result = $this->go([$this->line(2, '2026-09-04', credit: 75000)], $units);
        $row = $this->byLine($result)[2];

        $this->assertSame('missing_in_books', $row['outcome'], 'لا مطابقة تلقائية لمجموعة.');
        $this->assertSame([['suggestion' => true, 'unit_keys' => ['a', 'b'], 'sum_minor' => 75000, 'difference_minor' => 0]], $row['suggestions']);
        $this->assertSame(['missing_in_statement', 'missing_in_statement', 'missing_in_statement'], array_column($result['ledger'], 'outcome'), 'الوحدات المقترحة لا تُحجز.');
    }

    // ═══════════════════════════════ تنبيهات وحتمية ═══════════════════════════════

    /** @test */
    public function the_kind_hint_only_adds_a_warning_and_never_changes_the_match(): void
    {
        $unit = $this->unit('u1', 'invoice', 'INV-1', '2026-09-01', 'debit', 100000);
        // العميل: الفاتورة تأتي دائناً في كشفه؛ نوعها «دفعة» بدائن = ملتبس ⇒ تنبيه فقط.
        $row = $this->byLine($this->go([$this->line(2, '2026-09-01', credit: 100000, our: 'inv-1', kind: 'payment')], [$unit]))[2];

        $this->assertSame('matched', $row['outcome']);
        $this->assertSame([['code' => 'kind_side_mismatch', 'params' => ['kind' => 'payment', 'expected' => 'debit', 'actual' => 'credit']]], $row['warnings']);
    }

    /**
     * فحص بالخصائص على سيناريوهات عشوائية **حتمية** (مولّد خطي ثابت البذرة): أنماط الاستعمال المزدوج المتتابعة في المراجعة (مفتاح غامض، R3، مفاتيح متنافسة) تُحرَس بثوابت عامة
     * لا بحالات مفردة. الثوابت: (١) وحدة تُسنَد لسطر واحد على الأكثر؛ (٢) لا تُسنَد وحدة غير `active`؛ (٣) وحدة مرشّحة لسطر `ambiguous` لا تُطابَق في أي سطر؛
     * (٤) وحدة دفتر `matched` لها سطر `matched` واحد بالضبط؛ (٥) مخرجات متطابقة عند عكس ترتيب المدخلات.
     *
     * @test
     */
    public function double_use_invariants_hold_over_deterministic_random_scenarios(): void
    {
        $seed = 20261101;
        $rand = function (int $max) use (&$seed): int {
            $seed = ($seed * 1103515245 + 12345) & 0x7fffffff;

            return $seed % $max;
        };
        $numbers = ['', 'n1', 'n2', 'n3'];
        $kinds = ['invoice', 'purchase', 'payment', 'credit_note'];
        $states = ['active', 'active', 'active', 'active', 'neutralised', 'incomplete'];

        for ($case = 0; $case < 400; $case++) {
            $units = [];
            foreach (range(1, 1 + $rand(5)) as $i) {
                $state = $states[$rand(count($states))];
                $direction = $state === 'neutralised' ? 'none' : (['debit', 'credit'][$rand(2)]);
                $amount = $state === 'neutralised' ? 0 : [100, 100, 200][$rand(3)];
                $number = $numbers[1 + $rand(3)];
                $units[] = $this->unit("u{$i}", $kinds[$rand(4)], $number, '2026-09-0'.(1 + $rand(3)), $direction, $amount, $state, true, ['', 'e1', 'e2'][$rand(3)], $state === 'incomplete' ? ['reversal_outside_window'] : []);
            }
            $lines = [];
            foreach (range(1, 1 + $rand(5)) as $i) {
                $debit = $rand(2) === 0;
                $amount = [100, 100, 200][$rand(3)];
                $lines[] = $this->line(1 + $i, '2026-09-0'.(1 + $rand(3)), $debit ? $amount : 0, $debit ? 0 : $amount, ['', 'e1', 'e2', 'n1'][$rand(4)], $numbers[$rand(4)]);
            }

            $dateTol = $rand(3);
            $amountTol = [0, 0, 50][$rand(3)];
            $result = $this->go($lines, $units, dateTol: $dateTol, amountTol: $amountTol);
            $assigned = [];
            $ambiguousCandidates = [];
            foreach ($result['statement'] as $row) {
                if (in_array($row['outcome'], ['matched', 'amount_difference', 'date_difference'], true) && $row['unit_key'] !== null && $row['explanation']['code'] !== 'reversed_in_books') {
                    $assigned[$row['unit_key']][] = $row['ordinal'];
                    $unit = array_values(array_filter($units, fn (array $u): bool => $u['key'] === $row['unit_key']))[0];
                    $this->assertSame('active', $unit['state'], "case {$case}: وحدة غير نشطة أُسندت");
                }
                if ($row['outcome'] === 'ambiguous') {
                    foreach ($row['candidates'] ?? [] as $candidate) {
                        $ambiguousCandidates[$candidate['key']] = true;
                    }
                }
            }
            foreach ($assigned as $key => $ordinals) {
                $this->assertCount(1, $ordinals, "case {$case}: الوحدة {$key} أُسندت لأكثر من سطر");
            }
            foreach (array_keys($assigned) as $key) {
                $this->assertArrayNotHasKey($key, $ambiguousCandidates, "case {$case}: الوحدة {$key} مرشّحة لسطر غامض ومع ذلك أُسندت");
            }
            foreach ($result['ledger'] as $row) {
                if ($row['outcome'] === 'matched') {
                    $matchedLines = array_filter($result['statement'], fn (array $r): bool => $r['outcome'] === 'matched' && $r['unit_key'] === $row['unit_key']);
                    $this->assertCount(1, $matchedLines, "case {$case}: وحدة دفتر matched بلا سطر matched وحيد");
                }
            }
            $this->assertSame($result, $this->go(array_reverse($lines), array_reverse($units), dateTol: $dateTol, amountTol: $amountTol), "case {$case}: المخرجات تعتمد على ترتيب المدخلات");
        }
    }

    /** @test */
    public function the_output_does_not_depend_on_input_order(): void
    {
        $units = [
            $this->unit('u3', 'invoice', 'INV-3', '2026-09-03', 'debit', 30000),
            $this->unit('u1', 'invoice', 'INV-1', '2026-09-01', 'debit', 10000),
            $this->unit('u2', 'invoice', 'INV-2', '2026-09-02', 'debit', 20000),
        ];
        $lines = [$this->line(4, '2026-09-03', credit: 30000), $this->line(2, '2026-09-01', credit: 10000, our: 'inv-1'), $this->line(3, '2026-09-09', credit: 77)];

        $a = $this->go($lines, $units);
        $b = $this->go(array_reverse($lines), array_reverse($units));

        $this->assertSame($a, $b);
        $this->assertSame([2, 3, 4], array_column($a['statement'], 'ordinal'));
    }
}
