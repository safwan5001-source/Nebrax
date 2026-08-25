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
        if ($batch->document_type !== 'purchase_invoice') throw ValidationException::withMessages(['document_type' => 'Readiness policy is not available for this document type.']);
        if (DocumentIssue::query()->where('document_extraction_result_id', $result->id)->where('severity', 'blocking')->whereIn('status', ['open', 'reopened'])->exists()) throw ValidationException::withMessages(['issues' => 'Blocking review issues remain open.']);
        $required = ['header.counterparty'];
        $lines = $result->normalized_payload['lines'] ?? [];
        foreach (array_keys(is_array($lines) ? $lines : []) as $index) { $required[] = "lines.{$index}.product"; $required[] = "lines.{$index}.unit"; }
        if (DocumentMatchResult::query()->where('document_extraction_result_id', $result->id)->whereIn('subject_key', $required)->where('status', '!=', 'confirmed')->exists()) throw ValidationException::withMessages(['matches' => 'Required matches require human confirmation.']);
        $reviewed = app(ReviewedDocumentProjector::class)->project($result);
        $fields = $reviewed['fields'] ?? [];
        foreach (['currency', 'document_date', 'document_number', 'subtotal_minor', 'tax_amount_minor', 'total_amount_minor'] as $field) if (($fields[$field] ?? null) === null || $fields[$field] === '') throw ValidationException::withMessages(['fields' => 'Required purchase evidence is incomplete.']);
        if (app(DocumentFinancialValidator::class)->validate($reviewed, 'purchase_invoice') !== []) throw ValidationException::withMessages(['financial' => 'Reviewed financial validation still has issues.']);
    }
}
