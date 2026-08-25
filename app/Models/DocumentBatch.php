<?php

namespace App\Models;

use App\Support\DocumentWorkflowStatus;
use App\Services\DocumentCenter\DocumentReviewMutationGate;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** حزمة العمل الأساسية لمركز المستندات؛ بيانات تشغيلية معزولة بالمستأجر والفرع. */
class DocumentBatch extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_type',
        'source_type',
        'schema_version',
        'created_by',
        'review_assigned_to',
    ];

    protected $attributes = [
        'status' => 'draft',
        'schema_version' => 1,
        'version' => 1,
    ];

    protected function casts(): array
    {
        return [
            'status' => DocumentWorkflowStatus::class,
            'schema_version' => 'integer',
            'version' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $batch): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document batches require trusted tenant and branch contexts.');
            }

            // Never trust scope identifiers supplied by callers.
            $batch->tenant_id = $tenant->id();
            $batch->branch_id = $branch->id();
        });

        static::updating(function (self $batch): void {
            if ($batch->isDirty('review_assigned_to')) {
                DocumentReviewMutationGate::assertOpen();
            }
            if ($batch->isDirty(['status', 'version'])) {
                throw new LogicException('Document workflow state may only change through DocumentWorkflowService.');
            }
            $allowed = ['review_assigned_to', 'failure_code', 'failure_message_safe', 'updated_at'];
            if (array_diff(array_keys($batch->getDirty()), $allowed) !== []) {
                throw new LogicException('Document batch identity and source fields are immutable.');
            }
        });
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'review_assigned_to');
    }

    public function workflowEvents(): HasMany
    {
        return $this->hasMany(DocumentWorkflowEvent::class);
    }

    public function files(): HasMany
    {
        return $this->hasMany(DocumentFile::class);
    }

    public function issues(): HasMany
    {
        return $this->hasMany(DocumentIssue::class);
    }

    public function extractionResults(): HasMany
    {
        return $this->hasMany(DocumentExtractionResult::class);
    }

    public function transactionLinks(): HasMany
    {
        return $this->hasMany(DocumentTransactionLink::class);
    }
}
