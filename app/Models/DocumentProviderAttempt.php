<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** محاولة مزود خارجية، بسجل آمن من دون طلب أو استجابة خامين. */
class DocumentProviderAttempt extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_batch_id',
        'document_file_id',
        'document_processing_run_id',
        'sequence',
        'provider_key',
        'model',
        'status',
        'error_code',
        'error_message_safe',
        'page_count',
        'input_tokens',
        'output_tokens',
        'provider_request_id',
        'processing_duration_ms',
        'started_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'page_count' => 'integer',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'processing_duration_ms' => 'integer',
            'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $attempt): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document provider attempts require trusted tenant and branch contexts.');
            }

            $run = DocumentProcessingRun::query()->findOrFail($attempt->document_processing_run_id);
            if ($run->tenant_id !== $tenant->id()
                || $run->branch_id !== $branch->id()
                || $run->document_batch_id !== $attempt->document_batch_id
                || $run->document_file_id !== $attempt->document_file_id) {
                throw new LogicException('Document provider attempt scope must match its processing run.');
            }

            $attempt->tenant_id = $tenant->id();
            $attempt->branch_id = $branch->id();
        });

        static::updating(function (self $attempt): void {
            $allowed = [
                'status', 'error_code', 'error_message_safe', 'input_tokens', 'output_tokens',
                'provider_request_id', 'processing_duration_ms', 'finished_at', 'updated_at',
            ];
            if (array_diff(array_keys($attempt->getDirty()), $allowed) !== []) {
                throw new LogicException('Document provider attempt identity fields are immutable.');
            }
        });

        static::deleting(fn () => throw new LogicException('Document provider attempts are retained as audit evidence.'));
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
}
