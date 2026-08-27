<?php

namespace App\Models;

use App\Support\DocumentScanStatus;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** ملف أصلي خاص داخل حزمة مستندات؛ لا يظهر مفتاح التخزين في أي Resource. */
class DocumentFile extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_batch_id',
        'storage_profile',
        'object_key',
        'original_name',
        'declared_mime',
        'detected_mime',
        'size_bytes',
        'page_count',
        'sha256',
        'scan_status',
        'scan_provider',
        'scanned_at',
        'uploaded_by',
        'retention_until',
        'purged_at',
        'purge_pending_at',
        'purge_reason_code',
        'document_retention_policy_id',
    ];

    protected $attributes = [
        'storage_profile' => 'platform',
        'scan_status' => 'pending',
    ];

    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'page_count' => 'integer',
            'scan_status' => DocumentScanStatus::class,
            'scanned_at' => 'immutable_datetime',
            'retention_until' => 'immutable_datetime',
            'purged_at' => 'immutable_datetime',
            'purge_pending_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $file): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document files require trusted tenant and branch contexts.');
            }

            $batch = DocumentBatch::query()->findOrFail($file->document_batch_id);
            if ($batch->tenant_id !== $tenant->id() || $batch->branch_id !== $branch->id()) {
                throw new LogicException('Document file scope must match its batch.');
            }

            $file->tenant_id = $tenant->id();
            $file->branch_id = $branch->id();
        });

        static::updating(function (self $file): void {
            $allowed = ['scan_status', 'scan_provider', 'scanned_at', 'retention_until', 'purged_at', 'purge_pending_at', 'purge_reason_code', 'document_retention_policy_id', 'updated_at'];
            if (array_diff(array_keys($file->getDirty()), $allowed) !== []) {
                throw new LogicException('Document file identity, evidence, and storage fields are immutable.');
            }
        });

        static::deleting(fn () => throw new LogicException('Document files require retention-aware purge.'));
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
