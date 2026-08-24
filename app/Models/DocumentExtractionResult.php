<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** نتيجة استخراج مطبعة ومشفرة؛ دليل مراجعة لا معاملة أعمال. */
class DocumentExtractionResult extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_batch_id',
        'document_file_id',
        'document_processing_run_id',
        'document_provider_attempt_id',
        'provider_key',
        'model',
        'schema_version',
        'detected_document_type',
        'detected_language',
        'confidence_basis_points',
        'normalized_payload',
        'extracted_at',
    ];

    protected $hidden = ['normalized_payload'];

    protected function casts(): array
    {
        return [
            'confidence_basis_points' => 'integer',
            'normalized_payload' => 'encrypted:array',
            'extracted_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $result): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document extraction results require trusted tenant and branch contexts.');
            }

            $run = DocumentProcessingRun::query()->findOrFail($result->document_processing_run_id);
            $attempt = DocumentProviderAttempt::query()->findOrFail($result->document_provider_attempt_id);
            if ($run->tenant_id !== $tenant->id()
                || $run->branch_id !== $branch->id()
                || $run->document_batch_id !== $result->document_batch_id
                || $run->document_file_id !== $result->document_file_id
                || $attempt->document_processing_run_id !== $run->id) {
                throw new LogicException('Document extraction result scope must match its processing run and provider attempt.');
            }

            $result->tenant_id = $tenant->id();
            $result->branch_id = $branch->id();
        });

        static::updating(fn () => throw new LogicException('Document extraction results are immutable.'));
        static::deleting(fn () => throw new LogicException('Document extraction results are retained as review evidence.'));
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(DocumentFile::class, 'document_file_id');
    }

    public function processingRun(): BelongsTo
    {
        return $this->belongsTo(DocumentProcessingRun::class, 'document_processing_run_id');
    }

    public function providerAttempt(): BelongsTo
    {
        return $this->belongsTo(DocumentProviderAttempt::class, 'document_provider_attempt_id');
    }
}
