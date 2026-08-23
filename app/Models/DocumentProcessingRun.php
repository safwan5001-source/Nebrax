<?php

namespace App\Models;

use App\Support\DocumentProcessingStatus;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** تشغيل خلفي idempotent لمرحلة محددة من ملف مستند. */
class DocumentProcessingRun extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_batch_id',
        'document_file_id',
        'stage',
        'status',
        'attempt_count',
        'job_uuid',
        'error_code',
        'error_message_safe',
        'queued_at',
        'started_at',
        'finished_at',
        'next_retry_at',
    ];

    protected $attributes = [
        'status' => 'queued',
        'attempt_count' => 0,
    ];

    protected function casts(): array
    {
        return [
            'status' => DocumentProcessingStatus::class,
            'attempt_count' => 'integer',
            'queued_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime',
            'next_retry_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $run): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document processing runs require trusted tenant and branch contexts.');
            }

            $file = DocumentFile::query()->findOrFail($run->document_file_id);
            if ($file->document_batch_id !== $run->document_batch_id
                || $file->tenant_id !== $tenant->id()
                || $file->branch_id !== $branch->id()) {
                throw new LogicException('Document processing scope must match its file and batch.');
            }

            $run->tenant_id = $tenant->id();
            $run->branch_id = $branch->id();
        });

        static::updating(function (self $run): void {
            $allowed = [
                'status', 'attempt_count', 'job_uuid', 'error_code', 'error_message_safe',
                'queued_at', 'started_at', 'finished_at', 'next_retry_at', 'updated_at',
            ];
            if (array_diff(array_keys($run->getDirty()), $allowed) !== []) {
                throw new LogicException('Document processing identity fields are immutable.');
            }
        });

        static::deleting(fn () => throw new LogicException('Document processing runs are retained as audit evidence.'));
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(DocumentFile::class, 'document_file_id');
    }
}
