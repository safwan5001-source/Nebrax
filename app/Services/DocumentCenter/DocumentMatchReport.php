<?php

namespace App\Services\DocumentCenter;

final class DocumentMatchReport
{
    /** @var list<array<string, mixed>> */
    public array $results = [];

    /** @var list<array<string, mixed>> */
    public array $issues = [];

    /** @param list<array<string, mixed>> $candidates */
    public function addResult(string $subjectType, string $subjectKey, array $candidates): void
    {
        usort($candidates, function (array $left, array $right): int {
            $score = $right['score_basis_points'] <=> $left['score_basis_points'];
            return $score !== 0 ? $score : strcmp((string) $left['candidate_id'], (string) $right['candidate_id']);
        });
        $top = $candidates[0] ?? null;
        $ambiguous = $top !== null && isset($candidates[1]) && $candidates[1]['score_basis_points'] === $top['score_basis_points'];
        $this->results[] = [
            'subject_type' => $subjectType,
            'subject_key' => $subjectKey,
            'status' => $top === null ? 'unmatched' : 'suggested',
            'matched_type' => $top['candidate_type'] ?? null,
            'matched_id' => $top['candidate_id'] ?? null,
            'strategy' => $top['strategy'] ?? null,
            'score_basis_points' => $top['score_basis_points'] ?? null,
            'explanation_codes' => $top['explanation_codes'] ?? [],
            'candidates' => array_values($candidates),
            'ambiguous' => $ambiguous,
        ];
    }

    /** @param array<string, scalar|null> $metadata */
    public function issue(string $subjectKey, string $code, string $severity, string $safeMessage, array $metadata = []): void
    {
        $this->issues[] = compact('subjectKey', 'code', 'severity', 'safeMessage', 'metadata');
    }
}
