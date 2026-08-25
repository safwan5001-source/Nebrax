<?php

namespace App\Services\DocumentCenter;

use App\Contracts\TransactionDraftBuilder;
use App\Models\CostCenter;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentMatchResult;
use App\Models\DocumentReviewAction;
use App\Models\DocumentTransactionLink;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\UnitConversion;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class PurchaseDocumentDraftBuilder implements TransactionDraftBuilder
{
    public function __construct(
        private readonly PurchaseService $purchases,
        private readonly UnitConversion $units,
        private readonly DocumentWorkflowService $workflow,
        private readonly ReviewedDocumentProjector $projector,
        private readonly DocumentReviewReadinessPolicy $readiness,
    ) {
    }

    /** @return array{link_id:string,purchase_id:string,purchase_number:string,status:string,idempotent_replay:bool} */
    public function build(DocumentBatch $batch, int $expectedVersion, string $reason, ?string $warehouseId, ?string $costCenterId, ?string $actorId): array
    {
        return DB::transaction(function () use ($batch, $expectedVersion, $reason, $warehouseId, $costCenterId, $actorId): array {
            $batch = DocumentBatch::query()->whereKey($batch->id)->lockForUpdate()->firstOrFail();
            $reason = $this->reason($reason);
            $existing = DocumentTransactionLink::query()
                ->where('document_batch_id', $batch->id)
                ->where('transaction_type', 'purchase')
                ->lockForUpdate()
                ->first();
            if ($existing !== null) {
                return $this->replay($batch, $existing);
            }

            if ($batch->version !== $expectedVersion) {
                throw new StaleDocumentReviewVersion();
            }
            if ($batch->document_type !== 'purchase_invoice' || $batch->status !== DocumentWorkflowStatus::READY_FOR_DRAFT) {
                throw ValidationException::withMessages(['batch' => 'Only a ready purchase invoice can create a purchase draft.']);
            }

            $result = DocumentExtractionResult::query()
                ->where('document_batch_id', $batch->id)
                ->latest('extracted_at')
                ->lockForUpdate()
                ->firstOrFail();
            $this->readiness->assertReady($batch, $result);
            $reviewed = $this->projector->project($result);
            $actor = $this->actor($actorId, $batch);
            $warehouse = $this->warehouse($warehouseId, $batch, $actor);
            $costCenter = $this->costCenter($costCenterId);
            $data = $this->header($reviewed, $batch, $warehouse, $costCenter?->id, $actor->id);
            $items = $this->items($result, $reviewed);

            $creating = $this->workflow->transition(
                $batch,
                DocumentWorkflowStatus::CREATING_DRAFT,
                'purchase_draft_creating',
                'user',
                $actor->id,
                $reason,
                ['transaction_type' => 'purchase'],
            );
            $purchase = $this->purchases->create($data, $items);
            $this->assertTotals($purchase, $reviewed);

            $link = DocumentTransactionLink::create([
                'document_batch_id' => $creating->id,
                'document_extraction_result_id' => $result->id,
                'transaction_type' => 'purchase',
                'transaction_id' => $purchase->id,
                'status' => 'created',
                'created_by' => $actor->id,
            ]);
            $created = $this->workflow->transition(
                $creating,
                DocumentWorkflowStatus::DRAFT_CREATED,
                'purchase_draft_created',
                'user',
                $actor->id,
                $reason,
                ['transaction_type' => 'purchase', 'purchase_id' => $purchase->id],
            );
            DocumentReviewAction::create([
                'document_batch_id' => $created->id,
                'document_extraction_result_id' => $result->id,
                'subject_type' => 'transaction_link',
                'subject_id' => $link->id,
                'action' => 'purchase_draft_created',
                'before' => ['status' => DocumentWorkflowStatus::READY_FOR_DRAFT->value],
                'after' => ['status' => $created->status->value, 'purchase_id' => $purchase->id],
                'actor_id' => $actor->id,
                'reason' => $reason,
                'review_version' => $created->version,
                'occurred_at' => now('UTC'),
            ]);

            return $this->response($link, $purchase, false);
        }, 3);
    }

    /** @return array{link_id:string,purchase_id:string,purchase_number:string,status:string,idempotent_replay:bool} */
    private function replay(DocumentBatch $batch, DocumentTransactionLink $link): array
    {
        $purchase = Purchase::query()->whereKey($link->transaction_id)->lockForUpdate()->first();
        if ($batch->status !== DocumentWorkflowStatus::DRAFT_CREATED || $link->status !== 'created' || $purchase === null || $purchase->status !== 'draft') {
            throw ValidationException::withMessages(['batch' => 'The existing purchase draft link is inconsistent and cannot be replayed.']);
        }

        return $this->response($link, $purchase, true);
    }

    /** @param array<string,mixed> $reviewed @return array<string,mixed> */
    private function header(array $reviewed, DocumentBatch $batch, Warehouse $warehouse, ?string $costCenterId, ?string $actorId): array
    {
        $fields = is_array($reviewed['fields'] ?? null) ? $reviewed['fields'] : [];
        $currency = strtoupper((string) ($fields['currency'] ?? ''));
        if ($currency !== 'SAR') {
            throw ValidationException::withMessages(['currency' => 'The purchase domain currently supports SAR reviewed evidence only.']);
        }
        if (! is_string($fields['document_date'] ?? null) || ! is_string($fields['document_number'] ?? null) || ! is_bool($fields['price_includes_tax'] ?? null)) {
            throw ValidationException::withMessages(['fields' => 'Reviewed purchase header evidence is incomplete.']);
        }

        return [
            'partner_id' => $this->partnerId($batch),
            'warehouse_id' => $warehouse->id,
            'cost_center_id' => $costCenterId,
            'purchase_date' => $fields['document_date'],
            'supplier_invoice_no' => trim($fields['document_number']),
            'tax_inclusive' => $fields['price_includes_tax'],
            'discount' => $this->minor($fields['discount_minor'] ?? 0, 'discount_minor'),
            'paid_on_post' => 0,
            'received_status' => 'pending',
            'notes' => 'Document batch '.$batch->id,
            'created_by' => $actorId,
        ];
    }

    /** @param array<string,mixed> $reviewed @return list<array<string,mixed>> */
    private function items(DocumentExtractionResult $result, array $reviewed): array
    {
        $lines = $reviewed['lines'] ?? null;
        if (! is_array($lines) || $lines === []) {
            throw ValidationException::withMessages(['lines' => 'Reviewed purchase lines are required.']);
        }

        return array_map(function (mixed $line, int $index) use ($result): array {
            if (! is_array($line)) {
                throw ValidationException::withMessages(['lines' => 'Reviewed purchase line is invalid.']);
            }
            $product = $this->product($result, $index);
            $unit = $this->unit($result, $index, $product, $line['unit'] ?? null);

            return [
                'product_id' => $product->id,
                'description' => is_string($line['description'] ?? null) ? mb_substr(trim($line['description']), 0, 1000) : null,
                'quantity' => $this->quantity($line['quantity'] ?? null),
                'unit' => $unit,
                'unit_price' => $this->minor($line['unit_price_minor'] ?? null, "lines.{$index}.unit_price_minor"),
                'discount' => $this->minor($line['discount_minor'] ?? 0, "lines.{$index}.discount_minor"),
                'tax_rate' => $this->taxRate($line['tax_rate'] ?? null),
            ];
        }, $lines, array_keys($lines));
    }

    private function partnerId(DocumentBatch $batch): string
    {
        $match = $this->confirmedMatchForBatch($batch, 'header.counterparty');
        if ($match->matched_type !== 'partner') {
            throw ValidationException::withMessages(['matches' => 'Confirmed counterparty match is not a supplier.']);
        }
        $partner = Partner::query()->whereKey($match->matched_id)->firstOrFail();
        if (! $partner->is_active || ! $partner->isSupplier()) {
            throw ValidationException::withMessages(['partner' => 'Confirmed supplier is unavailable.']);
        }

        return $partner->id;
    }

    private function product(DocumentExtractionResult $result, int $index): Product
    {
        $match = $this->confirmedMatch($result, "lines.{$index}.product");
        if ($match->matched_type !== 'product') {
            throw ValidationException::withMessages(['matches' => 'Confirmed line product match is invalid.']);
        }
        $product = Product::query()->whereKey($match->matched_id)->firstOrFail();
        if (! $product->is_active) {
            throw ValidationException::withMessages(['product' => 'Confirmed product is unavailable.']);
        }

        return $product;
    }

    private function unit(DocumentExtractionResult $result, int $index, Product $product, mixed $unit): string
    {
        $match = $this->confirmedMatch($result, "lines.{$index}.unit");
        if ($match->matched_type !== 'product_unit' || $match->matched_id !== $product->id || ! is_string($unit) || trim($unit) === '') {
            throw ValidationException::withMessages(['unit' => 'Confirmed product unit is invalid.']);
        }

        try {
            [$name] = $this->units->resolve($product, trim($unit));
        } catch (\RuntimeException) {
            throw ValidationException::withMessages(['unit' => 'Confirmed unit is not allowed for this product.']);
        }

        return $name;
    }

    private function confirmedMatchForBatch(DocumentBatch $batch, string $key): DocumentMatchResult
    {
        return DocumentMatchResult::query()
            ->where('document_batch_id', $batch->id)
            ->where('subject_key', $key)
            ->where('status', 'confirmed')
            ->lockForUpdate()
            ->sole();
    }

    private function confirmedMatch(DocumentExtractionResult $result, string $key): DocumentMatchResult
    {
        return DocumentMatchResult::query()
            ->where('document_extraction_result_id', $result->id)
            ->where('subject_key', $key)
            ->where('status', 'confirmed')
            ->lockForUpdate()
            ->sole();
    }

    private function actor(?string $actorId, DocumentBatch $batch): User
    {
        if ($actorId === null) {
            throw ValidationException::withMessages(['actor' => 'An authenticated reviewer is required to create a purchase draft.']);
        }

        $actor = User::query()->findOrFail($actorId);
        if (! $actor->canAccessBranch($batch->branch_id)) {
            throw ValidationException::withMessages(['actor' => 'The reviewer is outside the document branch access scope.']);
        }

        return $actor;
    }

    private function warehouse(?string $warehouseId, DocumentBatch $batch, User $actor): Warehouse
    {
        $warehouse = $warehouseId === null
            ? Warehouse::query()->where('branch_id', $batch->branch_id)->where('is_active', true)->orderByDesc('is_default')->orderBy('code')->first()
            : Warehouse::query()->whereKey($warehouseId)->first();
        if ($warehouse === null || ! $warehouse->is_active || ($warehouse->branch_id !== null && $warehouse->branch_id !== $batch->branch_id)) {
            throw ValidationException::withMessages(['warehouse_id' => 'A valid active warehouse for this branch is required.']);
        }
        if (! $actor->canAccessWarehouse($warehouse->id)) {
            throw ValidationException::withMessages(['warehouse_id' => 'The selected warehouse is outside the reviewer access scope.']);
        }

        return $warehouse;
    }

    private function costCenter(?string $costCenterId): ?CostCenter
    {
        if ($costCenterId === null) {
            return null;
        }

        $costCenter = CostCenter::query()->whereKey($costCenterId)->first();
        if ($costCenter === null || ! $costCenter->is_active) {
            throw ValidationException::withMessages(['cost_center_id' => 'The selected cost center is unavailable.']);
        }

        return $costCenter;
    }

    /** @param array<string,mixed> $reviewed */
    private function assertTotals(Purchase $purchase, array $reviewed): void
    {
        $fields = is_array($reviewed['fields'] ?? null) ? $reviewed['fields'] : [];
        foreach (['subtotal_minor' => 'subtotal', 'tax_amount_minor' => 'tax_amount', 'total_amount_minor' => 'total'] as $field => $attribute) {
            $expected = $this->minor($fields[$field] ?? null, $field);
            if (abs($purchase->{$attribute} - $expected) > 1) {
                throw ValidationException::withMessages(['financial' => 'Purchase totals do not match the reviewed document evidence.']);
            }
        }
    }

    private function quantity(mixed $value): int
    {
        if (! is_string($value) && ! is_int($value)) {
            throw ValidationException::withMessages(['quantity' => 'Purchase quantity must be a positive integer.']);
        }
        $value = trim((string) $value);
        if (! preg_match('/^[1-9]\d*$/', $value)
            || strlen($value) > strlen('1000000')
            || (strlen($value) === strlen('1000000') && strcmp($value, '1000000') > 0)) {
            throw ValidationException::withMessages(['quantity' => 'purchase_quantity_precision_unsupported']);
        }

        return (int) $value;
    }

    private function minor(mixed $value, string $field): int
    {
        if (! is_int($value) || $value < 0) {
            throw ValidationException::withMessages([$field => 'Reviewed monetary evidence must be a non-negative minor-unit integer.']);
        }

        return $value;
    }

    private function taxRate(mixed $value): int
    {
        if (is_int($value) && $value >= 0 && $value <= 100) {
            return $value;
        }
        if (is_string($value) && preg_match('/^\d{1,3}$/', $value) && (int) $value <= 100) {
            return (int) $value;
        }

        throw ValidationException::withMessages(['tax_rate' => 'Reviewed tax rate is unsupported.']);
    }

    private function reason(string $reason): string
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw ValidationException::withMessages(['reason' => 'A bounded draft-build reason is required.']);
        }

        return $reason;
    }

    /** @return array{link_id:string,purchase_id:string,purchase_number:string,status:string,idempotent_replay:bool} */
    private function response(DocumentTransactionLink $link, Purchase $purchase, bool $replay): array
    {
        return [
            'link_id' => $link->id,
            'purchase_id' => $purchase->id,
            'purchase_number' => $purchase->number,
            'status' => $purchase->status,
            'idempotent_replay' => $replay,
        ];
    }
}
