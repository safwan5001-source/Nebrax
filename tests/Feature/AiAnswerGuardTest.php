<?php

namespace Tests\Feature;

use App\Support\AiAnswerGuard;
use App\Support\AiToolResultDigest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** AI-07 — pure guards around the external model: number grounding, sanitising, name restoration, result digest. */
class AiAnswerGuardTest extends TestCase
{
    private const DIGEST = ['totals' => ['total' => '1150.00', 'b0_30' => '1000.50'], 'period' => ['from' => '2026-10-01', 'to' => '2026-10-20']];

    /** @return array<string,array{0:string,1:bool}> */
    public static function answers(): array
    {
        return [
            'exact figure' => ['Total outstanding is 1150.00 SAR.', true],
            'thousands separator and dropped zeros' => ['Outstanding: 1,150 SAR and 1000.5 in the first bucket.', true],
            'arabic-indic digits' => ['الإجمالي ١١٥٠٫٠٠ ريال', true],
            'dates and small counts' => ['From 2026-10-01 to 2026-10-20 there are 3 parties over 30 days.', true],
            'no numbers at all' => ['No overdue balances.', true],
            'invented figure' => ['Total outstanding is 1151.00 SAR.', false],
            'derived percentage with decimals' => ['That is 12.5 of the total.', false],
            'derived sum' => ['Together 2150 SAR.', false],
            'arabic invented' => ['الإجمالي ٩٩٩٩ ريال', false],
        ];
    }

    #[DataProvider('answers')]
    public function test_numbers_must_come_from_the_digest(string $answer, bool $grounded): void
    {
        $this->assertSame($grounded, AiAnswerGuard::isGrounded($answer, [self::DIGEST]));
    }

    public function test_without_a_digest_any_large_or_fractional_number_is_ungrounded(): void
    {
        $this->assertTrue(AiAnswerGuard::isGrounded('I can show 3 reports.', []));
        $this->assertFalse(AiAnswerGuard::isGrounded('Revenue was 5000.', []));
    }

    public function test_sanitize_strips_controls_bidi_overrides_and_truncates(): void
    {
        $clean = AiAnswerGuard::sanitize("a\u{202E}b\x07c\u{200B}d" . str_repeat('x', 50), 10);

        $this->assertSame(10, mb_strlen($clean));
        $this->assertStringNotContainsString("\u{202E}", $clean);
        $this->assertStringNotContainsString("\x07", $clean);
    }

    public function test_party_tokens_are_restored_longest_first(): void
    {
        $text = AiAnswerGuard::restoreNames('Party-1 and Party-10 owe.', ['Party-1' => 'Alpha', 'Party-10' => 'Omega']);

        $this->assertSame('Alpha and Omega owe.', $text);
        $this->assertSame('Party-3 stays.', AiAnswerGuard::restoreNames('Party-3 stays.', ['Party-1' => 'Alpha']));
    }

    /** @return array{minor:int, decimal:string} */
    private function money(int $minor): array
    {
        return ['minor' => $minor, 'decimal' => number_format($minor / 100, 2, '.', '')];
    }

    /** @return array<string,mixed> */
    private function row(string $id, string $name, int $total): array
    {
        return ['partner_id' => $id, 'name' => $name, 'b0_30' => $this->money($total), 'b31_60' => $this->money(0), 'b61_90' => $this->money(0), 'b90_plus' => $this->money(0), 'total' => $this->money($total)];
    }

    public function test_digest_drops_identities_and_pseudonymises_parties_largest_first(): void
    {
        $result = [
            'report' => 'receivables_aging', 'currency' => 'SAR', 'timezone' => 'Asia/Riyadh', 'as_of' => '2026-10-20',
            'totals' => $this->row('x', 'x', 300),
            'partner_detail' => 'included',
            'rows' => [$this->row('11111111-1111-4111-8111-111111111111', 'Small Co', 100), $this->row('22222222-2222-4222-8222-222222222222', 'Big Co', 200)],
            'warnings' => [['code' => 'as_of_not_historical']],
            'scope' => ['branch' => ['mode' => 'all', 'ids' => ['b1']]], 'sources' => [['api_path' => '/api/reports/x']],
        ];

        $built = AiToolResultDigest::build($result, 3000);

        $this->assertSame(['Party-1' => 'Big Co', 'Party-2' => 'Small Co'], $built['names']);
        $json = json_encode($built['digest']);
        foreach (['Big Co', 'Small Co', '11111111', 'partner_id', 'api_path', 'branch', 'sources'] as $leak) {
            $this->assertStringNotContainsString($leak, $json, $leak);
        }
        $this->assertSame('2.00', $built['digest']['rows'][0]['total']);
        $this->assertSame('3.00', $built['digest']['totals']['total']);
        $this->assertSame(['as_of_not_historical'], $built['digest']['warnings']);
    }

    public function test_digest_trims_rows_to_fit_the_token_budget_and_says_so(): void
    {
        $rows = [];
        for ($i = 1; $i <= 60; $i++) {
            $rows[] = $this->row("id-{$i}", "N{$i}", $i);
        }
        $result = ['report' => 'payables_aging', 'currency' => 'SAR', 'as_of' => '2026-10-20', 'totals' => $rows[0], 'partner_detail' => 'included', 'rows' => $rows, 'warnings' => []];

        $built = AiToolResultDigest::build($result, 400);

        $this->assertLessThanOrEqual(400, AiToolResultDigest::estimateTokens($built['digest']));
        $this->assertSame(60, count($built['digest']['rows']) + $built['digest']['rows_omitted']);
        $this->assertGreaterThan(0, $built['digest']['rows_omitted']);
    }
}
