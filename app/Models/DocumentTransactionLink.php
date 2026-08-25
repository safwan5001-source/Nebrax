<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class DocumentTransactionLink extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_batch_id',
        'document_extraction_result_id',
        'transaction_type',
        'transaction_id',
        'status',
        'created_by',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $link): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document transaction links require trusted tenant and branch contexts.');
            }

            $batch = DocumentBatch::query()->findOrFail($link->document_batch_id);
            $result = DocumentExtractionResult::query()->findOrFail($link->document_extraction_result_id);
            $purchase = Purchase::query()->findOrFail($link->transaction_id);
            $actor = $link->created_by === null ? null : User::query()->find($link->created_by);
            if ($actor === null
                || ! $actor->canAccessBranch($batch->branch_id)
                || $link->transaction_type !== 'purchase'
                || $batch->tenant_id !== $tenant->id()
                || $batch->branch_id !== $branch->id()
                || $result->tenant_id !== $tenant->id()
                || $result->branch_id !== $branch->id()
                || $result->document_batch_id !== $batch->id
                || $purchase->tenant_id !== $tenant->id()
                || $purchase->branch_id !== $branch->id()
                || $purchase->status !== 'draft') {
                throw new LogicException('Document transaction link scope or transaction state is invalid.');
            }

            $link->tenant_id = $tenant->id();
            $link->branch_id = $branch->id();
        });

        static::updating(fn () => throw new LogicException('Document transaction links are immutable.'));
        static::deleting(fn () => throw new LogicException('Document transaction links are retained for audit.'));
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function purchase(): BelongsTo
    {
        return $this->belongsTo(Purchase::class, 'transaction_id');
    }

    public function extractionResult(): BelongsTo
    {
        return $this->belongsTo(DocumentExtractionResult::class, 'document_extraction_result_id');
    }
}
