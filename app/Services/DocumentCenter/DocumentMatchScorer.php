<?php

namespace App\Services\DocumentCenter;

final class DocumentMatchScorer
{
    public function normalize(?string $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = trim(mb_strtolower($value));
        $value = str_replace(['أ', 'إ', 'آ'], 'ا', $value);
        $value = str_replace(['ى'], 'ي', $value);
        $value = preg_replace('/[^\p{L}\p{N}]+/u', '', $value) ?? '';

        return $value === '' ? null : $value;
    }

    public function exact(?string $left, ?string $right, int $score, string $strategy): ?array
    {
        $left = $this->normalize($left);
        $right = $this->normalize($right);
        if ($left === null || $right === null || $left !== $right) {
            return null;
        }

        return ['score_basis_points' => $score, 'strategy' => $strategy, 'explanation_codes' => [$strategy]];
    }

    public function nameSimilarity(?string $left, ?string $right): ?array
    {
        $left = $this->normalize($left);
        $right = $this->normalize($right);
        if ($left === null || $right === null) {
            return null;
        }
        if ($left === $right) {
            return ['score_basis_points' => 8500, 'strategy' => 'normalized_name', 'explanation_codes' => ['normalized_name_match']];
        }
        $score = $this->similarityBasisPoints($left, $right);
        if ($score < 7000) {
            return null;
        }

        return ['score_basis_points' => min(8400, $score), 'strategy' => 'normalized_name', 'explanation_codes' => ['normalized_name_match']];
    }

    private function similarityBasisPoints(string $left, string $right): int
    {
        $leftChars = preg_split('//u', $left, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $rightChars = preg_split('//u', $right, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if ($leftChars === [] || $rightChars === []) {
            return 0;
        }

        $previous = array_fill(0, count($rightChars) + 1, 0);
        foreach ($leftChars as $leftChar) {
            $current = [0];
            foreach ($rightChars as $index => $rightChar) {
                $current[$index + 1] = $leftChar === $rightChar
                    ? $previous[$index] + 1
                    : max($previous[$index + 1], $current[$index]);
            }
            $previous = $current;
        }

        return intdiv(20000 * $previous[count($rightChars)], count($leftChars) + count($rightChars));
    }
}
