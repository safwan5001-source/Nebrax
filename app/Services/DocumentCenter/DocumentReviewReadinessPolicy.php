<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchResult;
use Illuminate\Validation\ValidationException;

final class DocumentReviewReadinessPolicy
{
    public function assertReady(DocumentBatch $batch, DocumentExtractionResult $result): void
    {
        if ($batch->document_type !== 'purchase_invoice') {
            throw ValidationException::withMessages(['document_type' => 'Readiness policy is not available for this document type.']);
        }

        if (DocumentIssue::query()->where('document_extraction_result_id', $result->id)->where('severity', 'blocking')->whereIn('status', ['open', 'reopened'])->exists()) {
            throw ValidationException::withMessages(['issues' => 'Blocking review issues remain open.']);
        }

        $reviewed = app(ReviewedDocumentProjector::class)->project($result);
        $fields = $reviewed['fields'] ?? [];
        foreach (['currency', 'document_date', 'document_number', 'subtotal_minor', 'tax_amount_minor', 'total_amount_minor'] as $field) {
            if (($fields[$field] ?? null) === null || $fields[$field] === '') {
                throw ValidationException::withMessages(['fields' => 'Required purchase evidence is incomplete.']);
            }
        }

        $required = ['header.counterparty'];
        $lines = $reviewed['lines'] ?? [];
        if (! is_array($lines) || $lines === []) {
            throw ValidationException::withMessages(['lines' => 'A purchase invoice requires at least one reviewed line.']);
        }
        foreach (array_keys($lines) as $index) {
            $required[] = "lines.{$index}.product";
            $required[] = "lines.{$index}.unit";
        }

        $matches = DocumentMatchResult::query()
            ->where('document_extraction_result_id', $result->id)
            ->whereIn('subject_key', $required)
            ->lockForUpdate()
            ->get()
            ->groupBy('subject_key');

        foreach ($required as $key) {
            $records = $matches->get($key);
            if ($records === null || $records->count() !== 1 || $records->first()->status !== 'confirmed') {
                throw ValidationException::withMessages(['matches' => 'Every required match must exist exactly once and be confirmed.']);
            }
        }

        if (app(DocumentFinancialValidator::class)->validate($reviewed, 'purchase_invoice') !== []) {
            throw ValidationException::withMessages(['financial' => 'Reviewed financial validation still has issues.']);
        }
    }
}
