<?php

namespace App\Services\DocumentCenter;

use App\Contracts\CreatedDraftReference;
use App\Contracts\DraftBuildContext;
use App\Contracts\TransactionDraftBuilder;
use App\Models\Account;
use App\Models\CostCenter;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentMatchResult;
use App\Models\DocumentReviewAction;
use App\Models\DocumentTransactionLink;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Partner;
use App\Models\User;
use App\Services\Accounting\ExpenseService;
use App\Support\BranchSettings;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * تحويل دليل expense المراجع إلى رأس Expense واحد فقط. سطور الإيصال تبقى
 * دليلاً للتحقق من الرأس ولا تصبح بنود مصروف أو منتجات أو حقائق متحكم بها من العميل.
 */
final class ExpenseDocumentDraftBuilder implements TransactionDraftBuilder
{
    public function __construct(
        private readonly ExpenseService $expenses,
        private readonly DocumentWorkflowService $workflow,
        private readonly ReviewedDocumentProjector $projector,
        private readonly DocumentReviewReadinessPolicy $readiness,
    ) {
    }

    public function build(DocumentBatch $batch, DraftBuildContext $context): CreatedDraftReference
    {
        if (! $context->options instanceof ExpenseDraftBuildOptions) {
            throw ValidationException::withMessages(['options' => 'Expense draft options are required.']);
        }

        return DB::transaction(function () use ($batch, $context): CreatedDraftReference {
            $batch = DocumentBatch::query()->whereKey($batch->id)->lockForUpdate()->firstOrFail();
            $reason = $this->reason($context->reason);
            $existing = DocumentTransactionLink::query()
                ->where('document_batch_id', $batch->id)
                ->where('transaction_type', 'expense')
                ->lockForUpdate()
                ->first();
            if ($existing !== null) {
                return $this->replay($batch, $existing);
            }

            if ($batch->version !== $context->expectedVersion) {
                throw new StaleDocumentReviewVersion();
            }
            if ($batch->document_type !== 'expense' || $batch->status !== DocumentWorkflowStatus::READY_FOR_DRAFT) {
                throw ValidationException::withMessages(['batch' => 'Only a ready expense document can create an expense draft.']);
            }

            $result = DocumentExtractionResult::query()
                ->where('document_batch_id', $batch->id)
                ->latest('extracted_at')
                ->lockForUpdate()
                ->firstOrFail();
            $this->readiness->assertReady($batch, $result);
            $reviewed = $this->projector->project($result);
            $actor = $this->actor($context->actorId, $batch);
            $account = $this->account($context->options->accountId, $batch);
            $category = $this->category($context->options->categoryId);
            $costCenter = $this->costCenter($context->options->costCenterId);
            $partner = $this->partner($result);
            $data = $this->header($reviewed, $batch, $context->options, $account, $category, $costCenter, $partner, $actor);

            $creating = $this->workflow->transition(
                $batch,
                DocumentWorkflowStatus::CREATING_DRAFT,
                'expense_draft_creating',
                'user',
                $actor->id,
                $reason,
                ['transaction_type' => 'expense'],
            );
            $expense = $this->expenses->create($data);
            $this->assertTotals($expense, $reviewed);

            $link = DocumentTransactionLink::create([
                'document_batch_id' => $creating->id,
                'document_extraction_result_id' => $result->id,
                'transaction_type' => 'expense',
                'transaction_id' => $expense->id,
                'status' => 'created',
                'created_by' => $actor->id,
            ]);
            $created = $this->workflow->transition(
                $creating,
                DocumentWorkflowStatus::DRAFT_CREATED,
                'expense_draft_created',
                'user',
                $actor->id,
                $reason,
                ['transaction_type' => 'expense', 'transaction_id' => $expense->id],
            );
            DocumentReviewAction::create([
                'document_batch_id' => $created->id,
                'document_extraction_result_id' => $result->id,
                'subject_type' => 'transaction_link',
                'subject_id' => $link->id,
                'action' => 'expense_draft_created',
                'before' => ['status' => DocumentWorkflowStatus::READY_FOR_DRAFT->value],
                'after' => ['status' => $created->status->value, 'transaction_type' => 'expense', 'transaction_id' => $expense->id],
                'actor_id' => $actor->id,
                'reason' => $reason,
                'review_version' => $created->version,
                'occurred_at' => now('UTC'),
            ]);

            return $this->response($link, $expense, false);
        }, 3);
    }

    private function replay(DocumentBatch $batch, DocumentTransactionLink $link): CreatedDraftReference
    {
        $expense = Expense::query()->whereKey($link->transaction_id)->lockForUpdate()->first();
        if ($batch->status !== DocumentWorkflowStatus::DRAFT_CREATED
            || $link->status !== 'created'
            || $expense === null
            || ! in_array($expense->status, ['draft', 'posted', 'cancelled'], true)) {
            throw ValidationException::withMessages(['batch' => 'The existing expense transaction link is inconsistent and cannot be replayed.']);
        }

        return $this->response($link, $expense, true);
    }

    /** @param array<string,mixed> $reviewed @return array<string,mixed> */
    private function header(array $reviewed, DocumentBatch $batch, ExpenseDraftBuildOptions $options, Account $account, ?ExpenseCategory $category, ?CostCenter $costCenter, ?Partner $partner, User $actor): array
    {
        $fields = is_array($reviewed['fields'] ?? null) ? $reviewed['fields'] : [];
        $currency = strtoupper((string) ($fields['currency'] ?? ''));
        if ($currency !== 'SAR') {
            throw ValidationException::withMessages(['currency' => 'The expense domain currently supports SAR reviewed evidence only.']);
        }
        if (! is_string($fields['document_date'] ?? null) || trim($fields['document_date']) === '' || ! is_bool($fields['price_includes_tax'] ?? null)) {
            throw ValidationException::withMessages(['fields' => 'Reviewed expense header evidence is incomplete.']);
        }
        if (! in_array($options->paymentMethod, ['cash', 'bank', 'credit'], true)) {
            throw ValidationException::withMessages(['payment_method' => 'Expense payment method is unsupported.']);
        }
        if ($options->paymentMethod === 'credit' && $partner === null) {
            throw ValidationException::withMessages(['partner' => 'A confirmed supplier is required for a credit expense draft.']);
        }

        return [
            'account_id' => $account->id,
            'category_id' => $category?->id,
            'cost_center_id' => $costCenter?->id,
            'partner_id' => $partner?->id,
            'vendor_name' => $this->text($fields['issuer_name'] ?? null),
            'expense_date' => trim($fields['document_date']),
            'payment_method' => $options->paymentMethod,
            'description' => $this->description($reviewed, $batch),
            'amount' => $this->positiveMinor($fields['subtotal_minor'] ?? null, 'subtotal_minor'),
            'tax_rate' => $this->taxRate($fields['tax_amount_minor'] ?? null, $reviewed['lines'] ?? []),
            'created_by' => $actor->id,
        ];
    }

    private function actor(?string $actorId, DocumentBatch $batch): User
    {
        if ($actorId === null) {
            throw ValidationException::withMessages(['actor' => 'An authenticated reviewer is required to create an expense draft.']);
        }
        $actor = User::query()->findOrFail($actorId);
        if (! $actor->canAccessBranch($batch->branch_id)) {
            throw ValidationException::withMessages(['actor' => 'The reviewer is outside the document branch access scope.']);
        }

        return $actor;
    }

    private function account(string $accountId, DocumentBatch $batch): Account
    {
        $account = Account::query()->whereKey($accountId)->first();
        if ($account === null || ! $account->is_active || $account->type !== 'expense' || $account->is_group) {
            throw ValidationException::withMessages(['account_id' => 'The selected active leaf expense account is unavailable.']);
        }
        $branch = $batch->branch;
        if ((bool) (BranchSettings::current()['account_branch_scoping'] ?? false)
            && ($branch === null
                || ($branch->accounts()->exists() && ! $branch->accounts()->whereKey($account->id)->exists()))) {
            throw ValidationException::withMessages(['account_id' => 'The selected expense account is outside the document branch scope.']);
        }

        return $account;
    }

    private function category(?string $categoryId): ?ExpenseCategory
    {
        if ($categoryId === null) {
            return null;
        }
        $category = ExpenseCategory::query()->whereKey($categoryId)->where('is_active', true)->first();
        if ($category === null) {
            throw ValidationException::withMessages(['category_id' => 'The selected expense category is unavailable.']);
        }

        return $category;
    }

    private function costCenter(?string $costCenterId): ?CostCenter
    {
        if ($costCenterId === null) {
            return null;
        }
        $costCenter = CostCenter::query()->whereKey($costCenterId)->where('is_active', true)->first();
        if ($costCenter === null) {
            throw ValidationException::withMessages(['cost_center_id' => 'The selected cost center is unavailable.']);
        }

        return $costCenter;
    }

    private function partner(DocumentExtractionResult $result): ?Partner
    {
        $matches = DocumentMatchResult::query()
            ->where('document_extraction_result_id', $result->id)
            ->where('subject_key', 'header.counterparty')
            ->where('status', 'confirmed')
            ->lockForUpdate()
            ->get();
        if ($matches->isEmpty()) {
            return null;
        }
        if ($matches->count() !== 1 || $matches->first()->matched_type !== 'partner') {
            throw ValidationException::withMessages(['matches' => 'Confirmed expense counterparty match is invalid.']);
        }
        $partner = Partner::query()->whereKey($matches->first()->matched_id)->first();
        if ($partner === null || ! $partner->is_active || ! $partner->isSupplier()) {
            throw ValidationException::withMessages(['partner' => 'Confirmed expense supplier is unavailable.']);
        }

        return $partner;
    }

    /** @param array<string,mixed> $reviewed */
    private function assertTotals(Expense $expense, array $reviewed): void
    {
        $fields = is_array($reviewed['fields'] ?? null) ? $reviewed['fields'] : [];
        foreach (['subtotal_minor' => 'amount', 'tax_amount_minor' => 'tax_amount', 'total_amount_minor' => 'total'] as $field => $attribute) {
            $expected = $this->minor($fields[$field] ?? null, $field);
            if ($this->differenceExceeds((int) $expense->{$attribute}, $expected)) {
                throw ValidationException::withMessages(['financial' => 'Expense totals do not match the reviewed document evidence.']);
            }
        }
    }

    private function taxRate(mixed $taxAmount, mixed $lines): int
    {
        $taxAmount = $this->minor($taxAmount, 'tax_amount_minor');
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
            $rates[$this->validatedTaxRate($line['tax_rate'] ?? null)] = true;
        }
        if (count($rates) !== 1) {
            throw ValidationException::withMessages(['tax_rate' => 'Expense evidence has multiple tax rates and cannot become one draft.']);
        }

        return (int) array_key_first($rates);
    }

    private function validatedTaxRate(mixed $value): int
    {
        if (is_int($value) && $value >= 0 && $value <= 100) {
            return $value;
        }
        if (is_string($value) && preg_match('/^\d{1,3}$/', $value) && (int) $value <= 100) {
            return (int) $value;
        }

        throw ValidationException::withMessages(['tax_rate' => 'Expense line tax rate is missing or unsupported.']);
    }

    /** @param array<string,mixed> $reviewed */
    private function description(array $reviewed, DocumentBatch $batch): string
    {
        $fields = is_array($reviewed['fields'] ?? null) ? $reviewed['fields'] : [];
        $explicit = $this->text($fields['external_reference'] ?? null);
        if ($explicit !== null) {
            return $explicit;
        }
        $lines = $reviewed['lines'] ?? [];
        $firstLine = is_array($lines) && is_array($lines[0] ?? null) ? $this->text($lines[0]['description'] ?? null) : null;

        return $firstLine ?? 'Document batch '.$batch->id;
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

    private function reason(string $reason): string
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw ValidationException::withMessages(['reason' => 'A bounded draft-build reason is required.']);
        }

        return $reason;
    }

    private function text(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = trim(mb_substr($value, 0, 1000));

        return $value === '' ? null : $value;
    }

    private function response(DocumentTransactionLink $link, Expense $expense, bool $replay): CreatedDraftReference
    {
        return new CreatedDraftReference(
            linkId: $link->id,
            transactionType: $link->transaction_type,
            transactionId: $expense->id,
            transactionNumber: $expense->number,
            status: $expense->status,
            idempotentReplay: $replay,
        );
    }
}
