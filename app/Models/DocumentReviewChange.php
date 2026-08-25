<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class DocumentReviewChange extends BaseModel
{
    use BranchScoped;

    public $timestamps = false;

    protected $fillable = [
        'document_batch_id', 'document_extraction_result_id', 'target_type', 'target_key',
        'before_value', 'after_value', 'value_type', 'reason', 'actor_id', 'review_version',
    ];

    protected function casts(): array
    {
        return ['before_value' => 'array', 'after_value' => 'array', 'review_version' => 'integer', 'created_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $change): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document review changes require trusted tenant and branch contexts.');
            }
            $result = DocumentExtractionResult::query()->findOrFail($change->document_extraction_result_id);
            if ($result->tenant_id !== $tenant->id() || $result->branch_id !== $branch->id() || $result->document_batch_id !== $change->document_batch_id) {
                throw new LogicException('Document review change scope must match immutable extraction evidence.');
            }
            $change->tenant_id = $tenant->id();
            $change->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('Document review changes are append-only.'));
        static::deleting(fn () => throw new LogicException('Document review changes are retained as audit evidence.'));
    }

    public function batch(): BelongsTo { return $this->belongsTo(DocumentBatch::class, 'document_batch_id'); }
    public function extractionResult(): BelongsTo { return $this->belongsTo(DocumentExtractionResult::class, 'document_extraction_result_id'); }
}
