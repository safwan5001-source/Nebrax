<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use App\Services\DocumentCenter\DocumentReviewMutationGate;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** مشكلة مطابقة أو تحقق مالي؛ لا تصلح الدليل ولا تنشئ معاملة. */
class DocumentIssue extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_batch_id', 'document_extraction_result_id', 'subject_key', 'code',
        'severity', 'status', 'safe_message', 'metadata', 'resolved_by', 'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'resolved_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $issue): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document issues require trusted tenant and branch contexts.');
            }

            $extraction = DocumentExtractionResult::query()->findOrFail($issue->document_extraction_result_id);
            if ($extraction->tenant_id !== $tenant->id()
                || $extraction->branch_id !== $branch->id()
                || $extraction->document_batch_id !== $issue->document_batch_id) {
                throw new LogicException('Document issue scope must match its extraction evidence.');
            }
            if (! in_array($issue->severity, ['info', 'warning', 'blocking'], true)
                || ! in_array($issue->status, ['open'], true)) {
                throw new LogicException('PR-5 may only create open issues with an allowed severity.');
            }

            $issue->tenant_id = $tenant->id();
            $issue->branch_id = $branch->id();
        });

        static::updating(function (self $issue): void {
            $identity = ['tenant_id', 'branch_id', 'document_batch_id', 'document_extraction_result_id', 'subject_key', 'code'];
            if ($issue->isDirty($identity)) {
                throw new LogicException('Document issue identity is immutable.');
            }
            if ($issue->isDirty(['status', 'resolved_by', 'resolved_at'])) {
                DocumentReviewMutationGate::assertOpen();
                $allowed = ['status', 'resolved_by', 'resolved_at', 'updated_at'];
                if (array_diff(array_keys($issue->getDirty()), $allowed) !== []) {
                    throw new LogicException('PR-6 may only mutate reviewed issue decision fields.');
                }
                if (! in_array($issue->status, ['open', 'resolved', 'reopened'], true)) {
                    throw new LogicException('Document issue review status is invalid.');
                }
            }
        });

        static::deleting(fn () => throw new LogicException('Document issues are retained as review evidence.'));
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function extractionResult(): BelongsTo
    {
        return $this->belongsTo(DocumentExtractionResult::class, 'document_extraction_result_id');
    }
}
