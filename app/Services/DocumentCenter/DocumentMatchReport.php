<?php

namespace App\Services\DocumentCenter;

final class DocumentMatchReport
{
    /** @var list<array<string, mixed>> */
    public array $results = [];

    /** @var list<array<string, mixed>> */
    public array $issues = [];

    /**
     * يحفظ المرشحين بالترتيب الوحيد المعتمد في الطبقة كلها: الدرجة ثم UUID.
     *
     * @param list<array<string, mixed>> $candidates
     * @return array<string, mixed>
     */
    public function addResult(string $subjectType, string $subjectKey, array $candidates): array
    {
        $candidates = self::sortCandidates($candidates);
        $top = $candidates[0] ?? null;
        $entry = [
            'subject_type' => $subjectType,
            'subject_key' => $subjectKey,
            'status' => $top === null ? 'unmatched' : 'suggested',
            'matched_type' => $top['candidate_type'] ?? null,
            'matched_id' => $top['candidate_id'] ?? null,
            'strategy' => $top['strategy'] ?? null,
            'score_basis_points' => $top['score_basis_points'] ?? null,
            'explanation_codes' => $top['explanation_codes'] ?? [],
            'candidates' => $candidates,
            'ambiguous' => $top !== null
                && isset($candidates[1])
                && $candidates[1]['score_basis_points'] === $top['score_basis_points'],
        ];
        $this->results[] = $entry;

        return $entry;
    }

    /**
     * @param list<array<string, mixed>> $candidates
     * @return list<array<string, mixed>>
     */
    public static function sortCandidates(array $candidates): array
    {
        usort($candidates, static function (array $left, array $right): int {
            $score = $right['score_basis_points'] <=> $left['score_basis_points'];

            return $score !== 0
                ? $score
                : strcmp((string) $left['candidate_id'], (string) $right['candidate_id']);
        });

        return array_values($candidates);
    }

    /** @param array<string, scalar|null> $metadata */
    public function issue(string $subjectKey, string $code, string $severity, string $safeMessage, array $metadata = []): void
    {
        $this->issues[] = compact('subjectKey', 'code', 'severity', 'safeMessage', 'metadata');
    }
}
