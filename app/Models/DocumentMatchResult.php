<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use App\Services\DocumentCenter\DocumentReviewMutationGate;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** اقتراح مطابقة قابل للمراجعة البشرية، وليس قراراً مالياً أو master data. */
class DocumentMatchResult extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_batch_id', 'document_extraction_result_id', 'subject_type', 'subject_key',
        'status', 'matched_type', 'matched_id', 'strategy', 'score_basis_points',
        'explanation_codes', 'confirmed_by', 'confirmed_at',
    ];

    protected function casts(): array
    {
        return [
            'score_basis_points' => 'integer',
            'explanation_codes' => 'array',
            'confirmed_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $result): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document match results require trusted tenant and branch contexts.');
            }

            $extraction = DocumentExtractionResult::query()->findOrFail($result->document_extraction_result_id);
            if ($extraction->tenant_id !== $tenant->id()
                || $extraction->branch_id !== $branch->id()
                || $extraction->document_batch_id !== $result->document_batch_id) {
                throw new LogicException('Document match result scope must match its extraction evidence.');
            }

            if (! in_array($result->status, ['unmatched', 'suggested'], true)) {
                throw new LogicException('PR-5 may only create unmatched or suggested match results.');
            }

            $result->tenant_id = $tenant->id();
            $result->branch_id = $branch->id();
        });

        static::updating(function (self $result): void {
            $identity = ['tenant_id', 'branch_id', 'document_batch_id', 'document_extraction_result_id', 'subject_type', 'subject_key'];
            if ($result->isDirty($identity)) {
                throw new LogicException('Document match result identity is immutable.');
            }
            if ($result->isDirty(['status', 'confirmed_by', 'confirmed_at'])) {
                DocumentReviewMutationGate::assertOpen();
                $allowed = ['status', 'confirmed_by', 'confirmed_at', 'updated_at'];
                if (array_diff(array_keys($result->getDirty()), $allowed) !== []) {
                    throw new LogicException('PR-6 may only mutate reviewed match decision fields.');
                }
                if (! in_array($result->status, ['confirmed', 'rejected', 'suggested', 'unmatched'], true)) {
                    throw new LogicException('Document match review status is invalid.');
                }
            }
        });

        static::deleting(fn () => throw new LogicException('Document match results are retained as review evidence.'));
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function extractionResult(): BelongsTo
    {
        return $this->belongsTo(DocumentExtractionResult::class, 'document_extraction_result_id');
    }

    public function candidates(): HasMany
    {
        return $this->hasMany(DocumentMatchCandidate::class);
    }
}
