<?php

namespace Tests\Unit;

use App\Services\DocumentCenter\DocumentMatchReport;
use Tests\TestCase;

class DocumentMatchReportTest extends TestCase
{
    /** @test */
    public function documentMatchingUsesTheHighestScoreEvenWhenItArrivesAfterLowerCandidates(): void
    {
        $report = new DocumentMatchReport();
        $entry = $report->addResult('product', 'lines.0.product', [
            $this->candidate('00000000-0000-4000-8000-000000000010', 7000),
            $this->candidate('00000000-0000-4000-8000-000000000020', 10000),
        ]);

        $this->assertSame('00000000-0000-4000-8000-000000000020', $entry['matched_id']);
        $this->assertSame(10000, $entry['score_basis_points']);
        $this->assertFalse($entry['ambiguous']);
    }

    /** @test */
    public function documentMatchingDoesNotTreatLowerTiedCandidatesAsAnAmbiguity(): void
    {
        $report = new DocumentMatchReport();
        $entry = $report->addResult('product', 'lines.0.product', [
            $this->candidate('00000000-0000-4000-8000-000000000030', 7000),
            $this->candidate('00000000-0000-4000-8000-000000000020', 7000),
            $this->candidate('00000000-0000-4000-8000-000000000010', 9000),
        ]);

        $this->assertFalse($entry['ambiguous']);
        $this->assertSame('00000000-0000-4000-8000-000000000010', $entry['matched_id']);
    }

    /** @test */
    public function documentMatchingMarksOnlyTopScoreTiesAsAmbiguousAndRanksThemDeterministically(): void
    {
        $report = new DocumentMatchReport();
        $entry = $report->addResult('product', 'lines.0.product', [
            $this->candidate('00000000-0000-4000-8000-000000000020', 10000),
            $this->candidate('00000000-0000-4000-8000-000000000010', 10000),
        ]);

        $this->assertTrue($entry['ambiguous']);
        $this->assertSame('00000000-0000-4000-8000-000000000010', $entry['candidates'][0]['candidate_id']);
        $this->assertSame('00000000-0000-4000-8000-000000000020', $entry['candidates'][1]['candidate_id']);
    }

    /** @return array<string,mixed> */
    private function candidate(string $id, int $score): array
    {
        return [
            'candidate_type' => 'App\\Models\\Product',
            'candidate_id' => $id,
            'score_basis_points' => $score,
            'strategy' => 'test',
            'explanation_codes' => ['test'],
            'snapshot' => ['is_active' => true],
        ];
    }
}
