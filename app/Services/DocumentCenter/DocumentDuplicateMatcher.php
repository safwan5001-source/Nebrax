<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentExtractionResult;

final class DocumentDuplicateMatcher
{
    /** @param array<string,mixed> $payload
     *  @return list<array{subject_key:string,code:string,severity:string,safe_message:string,metadata:array<string,string>}>
     */
    public function issues(DocumentExtractionResult $result, array $payload): array
    {
        $fields = is_array($payload['fields'] ?? null) ? $payload['fields'] : [];
        $documentNumber = $this->text($fields['document_number'] ?? null);
        $tax = $this->text($fields['issuer_tax_number'] ?? null);
        $total = $this->minor($fields['total_amount_minor'] ?? null);
        $date = $this->text($fields['document_date'] ?? null);
        $issues = [];

        $existing = DocumentExtractionResult::query()
            ->where('id', '!=', $result->id)
            ->where('document_batch_id', '!=', $result->document_batch_id)
            ->get()
            ->filter(function (DocumentExtractionResult $other) use ($documentNumber, $tax, $total, $date): bool {
                $otherFields = is_array($other->normalized_payload['fields'] ?? null) ? $other->normalized_payload['fields'] : [];
                if ($documentNumber !== null && $tax !== null
                    && $documentNumber === $this->text($otherFields['document_number'] ?? null)
                    && $tax === $this->text($otherFields['issuer_tax_number'] ?? null)) {
                    return true;
                }
                return $documentNumber === null && $tax !== null && $total !== null && $date !== null
                    && $tax === $this->text($otherFields['issuer_tax_number'] ?? null)
                    && $total === $this->minor($otherFields['total_amount_minor'] ?? null)
                    && $date === $this->text($otherFields['document_date'] ?? null);
            })
            ->sortBy('id')
            ->first();

        if ($existing !== null) {
            $strong = $documentNumber !== null && $tax !== null;
            $issues[] = [
                'subject_key' => 'header.duplicate',
                'code' => 'logical_duplicate_detected',
                'severity' => $strong ? 'blocking' : 'warning',
                'safe_message' => $strong ? 'يوجد مستند سابق يحمل مرجعاً ومورداً مطابقين.' : 'قد يوجد مستند سابق بمورد وتاريخ وإجمالي متشابهين.',
                'metadata' => ['existing_extraction_result_id' => $existing->id],
            ];
        }

        return $issues;
    }

    private function text(mixed $value): ?string
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }
        $value = trim(mb_strtolower((string) $value));
        return $value === '' ? null : $value;
    }

    private function minor(mixed $value): ?int
    {
        return is_int($value) ? $value : (is_string($value) && preg_match('/^\d+$/', $value) ? (int) $value : null);
    }
}
