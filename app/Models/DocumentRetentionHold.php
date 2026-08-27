<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** Hold تشغيلي/قانوني آمن يمنع purge من دون حذف evidence. */
class DocumentRetentionHold extends BaseModel
{
    use BranchScoped;

    public const REASONS = [
        'legal_review',
        'operational_investigation',
        'customer_request',
        'compliance_review',
    ];

    public const RELEASE_REASONS = [
        'review_completed',
        'hold_no_longer_required',
        'entered_in_error',
    ];

    protected $fillable = [
        'document_batch_id',
        'document_file_id',
        'reason_code',
        'created_by',
        'released_at',
        'released_by',
        'release_reason_code',
    ];

    protected function casts(): array
    {
        return [
            'released_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $hold): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document retention holds require trusted tenant and branch contexts.');
            }
            if (! in_array($hold->reason_code, self::REASONS, true)) {
                throw new LogicException('Document retention hold reason is not permitted.');
            }
            if (blank($hold->document_batch_id) && blank($hold->document_file_id)) {
                throw new LogicException('Document retention hold requires a batch or file.');
            }

            $batch = $hold->document_batch_id === null ? null : DocumentBatch::query()->findOrFail($hold->document_batch_id);
            $file = $hold->document_file_id === null ? null : DocumentFile::query()->findOrFail($hold->document_file_id);
            if ($batch !== null && ($batch->tenant_id !== $tenant->id() || $batch->branch_id !== $branch->id())) {
                throw new LogicException('Document retention hold batch scope must match the trusted context.');
            }
            if ($file !== null && ($file->tenant_id !== $tenant->id() || $file->branch_id !== $branch->id())) {
                throw new LogicException('Document retention hold file scope must match the trusted context.');
            }
            if ($batch !== null && $file !== null && $file->document_batch_id !== $batch->id) {
                throw new LogicException('Document retention hold file must belong to its batch.');
            }

            $hold->tenant_id = $tenant->id();
            $hold->branch_id = $branch->id();
        });

        static::updating(function (self $hold): void {
            $allowed = ['released_at', 'released_by', 'release_reason_code', 'updated_at'];
            if (array_diff(array_keys($hold->getDirty()), $allowed) !== []) {
                throw new LogicException('Document retention hold identity is immutable.');
            }
            if ($hold->getOriginal('released_at') !== null || $hold->released_at === null
                || ! in_array($hold->release_reason_code, self::RELEASE_REASONS, true)) {
                throw new LogicException('Document retention hold may be released once with a permitted reason.');
            }
        });

        static::deleting(fn () => throw new LogicException('Document retention holds are retained as governance evidence.'));
    }

    /** @param Builder<self> $query */
    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('released_at');
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(DocumentFile::class, 'document_file_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function releaser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'released_by');
    }
}
