<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentExtractionResult;
use App\Models\DocumentReviewChange;
use LogicException;

final class ReviewedDocumentProjector
{
    /** @return array<string,mixed> */
    public function project(DocumentExtractionResult $result): array
    {
        $projection = $result->normalized_payload;
        foreach (DocumentReviewChange::query()->where('document_extraction_result_id', $result->id)->orderBy('review_version')->orderBy('id')->get() as $change) {
            $this->set($projection, $change->target_key, $change->after_value['value'] ?? null);
        }
        return $projection;
    }
    public function value(DocumentExtractionResult $result, string $key): mixed { $value = $this->project($result); foreach (explode('.', $key) as $segment) { if (!is_array($value) || !array_key_exists($segment, $value)) return null; $value = $value[$segment]; } return $value; }
    private function set(array &$value, string $key, mixed $after): void { $segments = explode('.', $key); $cursor =& $value; foreach ($segments as $segment) { if (!is_array($cursor) || !array_key_exists($segment, $cursor)) throw new LogicException('Review target does not exist in normalized evidence.'); $cursor =& $cursor[$segment]; } $cursor = $after; }
}
