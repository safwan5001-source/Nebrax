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
        if (! in_array($batch->document_type, ['purchase_invoice', 'expense'], true)) {
            throw ValidationException::withMessages(['document_type' => 'Readiness policy is not available for this document type.']);
        }

        if (DocumentIssue::query()->where('document_extraction_result_id', $result->id)->where('severity', 'blocking')->whereIn('status', ['open', 'reopened'])->exists()) {
            throw ValidationException::withMessages(['issues' => 'Blocking review issues remain open.']);
        }

        $reviewed = app(ReviewedDocumentProjector::class)->project($result);
        $fields = is_array($reviewed['fields'] ?? null) ? $reviewed['fields'] : [];
        foreach (['currency', 'document_date', 'document_number', 'subtotal_minor', 'tax_amount_minor', 'total_amount_minor'] as $field) {
            if (($fields[$field] ?? null) === null || $fields[$field] === '') {
                throw ValidationException::withMessages(['fields' => 'Required transaction evidence is incomplete.']);
            }
        }

        if ($batch->document_type === 'expense') {
            $this->assertExpenseFinancialEvidence($fields, $reviewed['lines'] ?? []);

            return;
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

    /** @param array<string,mixed> $fields */
    private function assertExpenseFinancialEvidence(array $fields, mixed $lines): void
    {
        if (! is_bool($fields['price_includes_tax'] ?? null)) {
            throw ValidationException::withMessages(['financial' => 'Expense evidence must state whether the reviewed price includes tax.']);
        }
        // في المستند الشامل لا نستخرج الأساس من الإجمالي: `subtotal_minor` يجب أن
        // يكون أساسًا مراجعًا صريحًا، وإلا يفشل التحقق قبل إنشاء Expense.
        $amount = $this->positiveMinor($fields['subtotal_minor'] ?? null, 'subtotal_minor');
        $tax = $this->minor($fields['tax_amount_minor'] ?? null, 'tax_amount_minor');
        $total = $this->minor($fields['total_amount_minor'] ?? null, 'total_amount_minor');
        $rate = $this->expenseTaxRate($tax, $lines);
        if ($amount > intdiv(PHP_INT_MAX - 50, max(1, $rate))) {
            throw ValidationException::withMessages(['financial' => 'Expense amount exceeds safe integer representation.']);
        }
        $expectedTax = intdiv($amount * $rate + 50, 100);
        if ($this->differenceExceeds($tax, $expectedTax) || $amount > PHP_INT_MAX - $tax || $this->differenceExceeds($total, $amount + $tax)) {
            throw ValidationException::withMessages(['financial' => 'Expense header totals or tax allocation are ambiguous.']);
        }
    }

    private function expenseTaxRate(int $taxAmount, mixed $lines): int
    {
        if (! is_array($lines) || $lines === []) {
            if ($taxAmount === 0) {
                return 0;
            }
            throw ValidationException::withMessages(['tax_rate' => 'Tax-bearing expense evidence requires one unambiguous reviewed line tax rate.']);
        }

        $rates = [];
        foreach ($lines as $line) {
            if (! is_array($line)) {
                throw ValidationException::withMessages(['tax_rate' => 'Expense line tax rate is missing or unsupported.']);
            }
            $rates[$this->taxRate($line['tax_rate'] ?? null)] = true;
        }
        if (count($rates) !== 1) {
            throw ValidationException::withMessages(['tax_rate' => 'Expense evidence has multiple tax rates and cannot become one draft.']);
        }

        return (int) array_key_first($rates);
    }

    private function taxRate(mixed $value): int
    {
        if (is_int($value) && $value >= 0 && $value <= 100) {
            return $value;
        }
        if (is_string($value) && preg_match('/^\d{1,3}$/', $value) && (int) $value <= 100) {
            return (int) $value;
        }

        throw ValidationException::withMessages(['tax_rate' => 'Expense line tax rate is missing or unsupported.']);
    }

    private function positiveMinor(mixed $value, string $field): int
    {
        $value = $this->minor($value, $field);
        if ($value <= 0) {
            throw ValidationException::withMessages([$field => 'Expense amount must be a positive minor-unit integer.']);
        }

        return $value;
    }

    private function minor(mixed $value, string $field): int
    {
        if (! is_int($value) || $value < 0) {
            throw ValidationException::withMessages([$field => 'Reviewed monetary evidence must be a non-negative minor-unit integer.']);
        }

        return $value;
    }

    private function differenceExceeds(int $left, int $right): bool
    {
        return $left >= $right ? $left - $right > 1 : $right - $left > 1;
    }
}
