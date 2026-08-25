<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentMatcher;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\Product;
use Illuminate\Support\Facades\DB;
use LogicException;

final class DocumentMatchingService implements DocumentMatcher
{
    public function __construct(
        private readonly DocumentCounterpartyMatcher $counterparties,
        private readonly DocumentProductMatcher $products,
        private readonly DocumentUnitMatcher $units,
        private readonly DocumentFinancialValidator $financial,
        private readonly DocumentDuplicateMatcher $duplicates,
    ) {
    }

    public function match(DocumentExtractionResult $providedResult, DocumentMatchingContext $context): DocumentMatchReport
    {
        if ($providedResult->tenant_id !== $context->tenantId || $providedResult->branch_id !== $context->branchId) {
            throw new LogicException('Document matching context must match extraction evidence scope.');
        }
        if ($providedResult->schema_version !== DocumentExtractionNormalizer::SCHEMA_VERSION) {
            throw new LogicException('Document matching requires document-schema-v1 evidence.');
        }

        return DB::transaction(function () use ($providedResult, $context): DocumentMatchReport {
            $result = DocumentExtractionResult::query()
                ->whereKey($providedResult->id)
                ->lockForUpdate()
                ->firstOrFail();
            if ($result->tenant_id !== $context->tenantId || $result->branch_id !== $context->branchId) {
                throw new LogicException('Locked extraction evidence scope must match matching context.');
            }

            $documentType = $this->trustedDocumentType($result);
            if ($context->documentType !== $documentType) {
                throw new LogicException('Document matching context type must match the trusted document batch type.');
            }
            if (DocumentMatchResult::query()->where('document_extraction_result_id', $result->id)->exists()) {
                return $this->existingReport($result);
            }

            $report = $this->buildReport($result, $documentType);
            $this->persist($result, $report);

            return $report;
        }, 3);
    }

    private function trustedDocumentType(DocumentExtractionResult $result): string
    {
        $batch = DocumentBatch::query()->whereKey($result->document_batch_id)->firstOrFail();
        if (! is_string($batch->document_type) || trim($batch->document_type) === '') {
            throw new LogicException('Document matching requires a trusted document batch type.');
        }

        return $batch->document_type;
    }

    private function buildReport(DocumentExtractionResult $result, string $documentType): DocumentMatchReport
    {
        $payload = $result->normalized_payload;
        $report = new DocumentMatchReport();
        $fields = is_array($payload['fields'] ?? null) ? $payload['fields'] : [];
        $counterparty = $report->addResult('counterparty', 'header.counterparty', $this->counterparties->candidates($fields, $documentType));
        $counterpartyCandidates = $counterparty['candidates'];
        if ($counterpartyCandidates === []) {
            $report->issue('header.counterparty', 'counterparty_not_found', 'warning', 'لم يُعثر على طرف مطابق ضمن النطاق المسموح.');
        } elseif ($counterparty['ambiguous']) {
            $report->issue('header.counterparty', 'counterparty_ambiguous', 'blocking', 'يوجد أكثر من طرف مطابق بنفس درجة الثقة.');
        } elseif (($counterpartyCandidates[0]['snapshot']['is_active'] ?? true) === false) {
            $report->issue('header.counterparty', 'counterparty_not_found', 'warning', 'الطرف المقترح غير نشط ويحتاج مراجعة بشرية.');
        }
        if ($this->counterpartyTaxIdConflicts($fields, $documentType, $counterpartyCandidates)) {
            $report->issue('header.counterparty', 'counterparty_tax_id_conflict', 'blocking', 'الرقم الضريبي المستخرج لا يطابق الطرف المقترح.');
        }

        $lines = is_array($payload['lines'] ?? null) ? $payload['lines'] : [];
        foreach ($lines as $index => $line) {
            if (! is_array($line)) {
                continue;
            }
            $productKey = "lines.{$index}.product";
            $product = $report->addResult('product', $productKey, $this->products->candidates($line));
            $productCandidates = $product['candidates'];
            if ($productCandidates === []) {
                $report->issue($productKey, 'product_not_found', 'warning', 'لم يُعثر على منتج مطابق ضمن النطاق المسموح.');
            } elseif ($product['ambiguous']) {
                $report->issue($productKey, 'product_ambiguous', 'blocking', 'يوجد أكثر من منتج مطابق بنفس درجة الثقة.');
            } elseif (($productCandidates[0]['snapshot']['is_active'] ?? true) === false) {
                $report->issue($productKey, 'product_not_found', 'warning', 'المنتج المقترح غير نشط ويحتاج مراجعة بشرية.');
            }
            if ($this->hasMultipleExactCandidates($productCandidates, 'exact_barcode')) {
                $report->issue($productKey, 'barcode_collision', 'blocking', 'الباركود المستخرج يشير إلى أكثر من منتج مرئي.');
            }
            if ($this->skuBarcodeConflict($productCandidates)) {
                $report->issue($productKey, 'sku_barcode_conflict', 'blocking', 'الـSKU والباركود المستخرجان يشيران إلى منتجين مختلفين.');
            }

            $selectedProduct = isset($productCandidates[0]['candidate_id'])
                ? Product::query()->whereKey($productCandidates[0]['candidate_id'])->first()
                : null;
            $unitKey = "lines.{$index}.unit";
            $unit = $this->units->match($selectedProduct, is_string($line['unit'] ?? null) ? $line['unit'] : null);
            $report->addResult('unit', $unitKey, $unit['candidate'] === null ? [] : [$unit['candidate']]);
            if ($unit['issue'] !== null) {
                $report->issue($unitKey, $unit['issue']['code'], $unit['issue']['severity'], $unit['issue']['message']);
            }
        }

        foreach ($this->financial->validate($payload, $documentType) as $issue) {
            $report->issue($issue['subject_key'], $issue['code'], $issue['severity'], $issue['safe_message'], $issue['metadata']);
        }
        foreach ($this->duplicates->issues($result, $payload) as $issue) {
            $report->issue($issue['subject_key'], $issue['code'], $issue['severity'], $issue['safe_message'], $issue['metadata']);
        }

        return $report;
    }

    private function persist(DocumentExtractionResult $result, DocumentMatchReport $report): void
    {
        foreach ($report->results as $entry) {
            $match = DocumentMatchResult::create([
                'document_batch_id' => $result->document_batch_id,
                'document_extraction_result_id' => $result->id,
                'subject_type' => $entry['subject_type'],
                'subject_key' => $entry['subject_key'],
                'status' => $entry['status'],
                'matched_type' => $entry['matched_type'],
                'matched_id' => $entry['matched_id'],
                'strategy' => $entry['strategy'],
                'score_basis_points' => $entry['score_basis_points'],
                'explanation_codes' => $entry['explanation_codes'],
            ]);
            foreach ($entry['candidates'] as $rank => $candidate) {
                DocumentMatchCandidate::create([
                    'document_match_result_id' => $match->id,
                    'candidate_type' => $candidate['candidate_type'],
                    'candidate_id' => $candidate['candidate_id'],
                    'rank' => $rank + 1,
                    'score_basis_points' => $candidate['score_basis_points'],
                    'strategy' => $candidate['strategy'],
                    'explanation_codes' => $candidate['explanation_codes'],
                    'snapshot' => $candidate['snapshot'],
                ]);
            }
        }
        foreach ($report->issues as $issue) {
            DocumentIssue::create([
                'document_batch_id' => $result->document_batch_id,
                'document_extraction_result_id' => $result->id,
                'subject_key' => $issue['subjectKey'],
                'code' => $issue['code'],
                'severity' => $issue['severity'],
                'status' => 'open',
                'safe_message' => $issue['safeMessage'],
                'metadata' => $issue['metadata'],
            ]);
        }
    }

    private function existingReport(DocumentExtractionResult $result): DocumentMatchReport
    {
        $report = new DocumentMatchReport();
        $matches = DocumentMatchResult::query()
            ->where('document_extraction_result_id', $result->id)
            ->orderBy('subject_type')
            ->orderBy('subject_key')
            ->get();
        foreach ($matches as $match) {
            $candidates = DocumentMatchCandidate::query()
                ->where('document_match_result_id', $match->id)
                ->get()
                ->map(static fn (DocumentMatchCandidate $candidate): array => [
                    'candidate_type' => $candidate->candidate_type,
                    'candidate_id' => $candidate->candidate_id,
                    'score_basis_points' => $candidate->score_basis_points,
                    'strategy' => $candidate->strategy,
                    'explanation_codes' => $candidate->explanation_codes,
                    'snapshot' => $candidate->snapshot,
                ])
                ->all();
            $report->addResult($match->subject_type, $match->subject_key, $candidates);
        }
        foreach (DocumentIssue::query()->where('document_extraction_result_id', $result->id)->orderBy('subject_key')->orderBy('code')->get() as $issue) {
            $report->issue($issue->subject_key, $issue->code, $issue->severity, $issue->safe_message, $issue->metadata ?? []);
        }

        return $report;
    }

    /** @param array<string,mixed> $fields @param list<array<string,mixed>> $candidates */
    private function counterpartyTaxIdConflicts(array $fields, string $documentType, array $candidates): bool
    {
        if ($candidates === []) {
            return false;
        }
        $isSupplier = str_contains(mb_strtolower($documentType), 'purchase') || str_contains(mb_strtolower($documentType), 'expense');
        $tax = $isSupplier ? ($fields['issuer_tax_number'] ?? null) : ($fields['recipient_tax_number'] ?? null);
        $candidateTax = $candidates[0]['snapshot']['vat_number'] ?? null;

        return $this->normalizedIdentifier($tax) !== null
            && $this->normalizedIdentifier($candidateTax) !== null
            && $this->normalizedIdentifier($tax) !== $this->normalizedIdentifier($candidateTax);
    }

    /** @param list<array<string,mixed>> $candidates */
    private function hasMultipleExactCandidates(array $candidates, string $strategy): bool
    {
        return count(array_unique(array_map(
            static fn (array $candidate): string => (string) $candidate['candidate_id'],
            array_filter($candidates, static fn (array $candidate): bool => $candidate['strategy'] === $strategy),
        ))) > 1;
    }

    /** @param list<array<string,mixed>> $candidates */
    private function skuBarcodeConflict(array $candidates): bool
    {
        $barcodeIds = array_unique(array_map(static fn (array $candidate): string => (string) $candidate['candidate_id'], array_filter($candidates, static fn (array $candidate): bool => $candidate['strategy'] === 'exact_barcode')));
        $skuIds = array_unique(array_map(static fn (array $candidate): string => (string) $candidate['candidate_id'], array_filter($candidates, static fn (array $candidate): bool => $candidate['strategy'] === 'exact_sku')));

        return $barcodeIds !== [] && $skuIds !== [] && array_intersect($barcodeIds, $skuIds) === [];
    }

    private function normalizedIdentifier(mixed $value): ?string
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }
        $normalized = preg_replace('/[^[:alnum:]]+/u', '', mb_strtolower((string) $value));

        return $normalized === '' ? null : $normalized;
    }
}
