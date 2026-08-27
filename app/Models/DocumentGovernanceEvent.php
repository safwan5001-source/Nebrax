<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل عمليات الحوكمة الآمن؛ metadata لا يقبل إلا مفاتيح تشغيلية غير حساسة. */
class DocumentGovernanceEvent extends BaseModel
{
    use BranchScoped;

    public const ACTION_RETRY_QUEUED = 'retry_queued';

    public const ACTION_RETRY_REJECTED = 'retry_rejected';

    public const ACTION_HOLD_CREATED = 'retention_hold_created';

    public const ACTION_HOLD_RELEASED = 'retention_hold_released';

    public const ACTION_REDACTED = 'redaction_created';

    public const ACTION_PURGE_PENDING = 'retention_purge_pending';

    public const ACTION_PURGED = 'retention_purged';

    public const ACTION_PURGE_RECONCILED = 'retention_purge_reconciled';

    public const ACTION_PURGE_STORAGE_FAILED = 'retention_purge_storage_failed';

    public const ACTION_RETENTION_SKIPPED = 'retention_skipped';

    public const ACTION_RETENTION_DRY_RUN_ELIGIBLE = 'retention_dry_run_eligible';

    public const ACTION_AUDIT_EXPORTED = 'audit_exported';

    public const ACTION_USAGE_EXPORTED = 'usage_exported';

    public const ACTION_DIAGNOSTICS_EXPORTED = 'diagnostics_exported';

    protected $fillable = [
        'document_batch_id',
        'document_file_id',
        'document_processing_run_id',
        'document_retention_hold_id',
        'document_redaction_overlay_id',
        'document_retention_run_id',
        'action',
        'stage',
        'status',
        'reason_code',
        'reason_message_safe',
        'actor_type',
        'actor_id',
        'metadata',
        'occurred_at',
    ];

    protected function casts(): array
    {
        return ['metadata' => 'array', 'occurred_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document governance events require trusted tenant and branch contexts.');
            }
            if (blank($event->action)) {
                throw new LogicException('Document governance event action is required.');
            }
            foreach (self::linkedModels($event) as $model) {
                if ($model->tenant_id !== $tenant->id() || $model->branch_id !== $branch->id()) {
                    throw new LogicException('Document governance event scope must match its linked evidence.');
                }
            }
            if (! self::safeMetadata($event->metadata ?? [])) {
                throw new LogicException('Document governance event metadata is not permitted.');
            }

            $event->tenant_id = $tenant->id();
            $event->branch_id = $branch->id();
            $event->occurred_at ??= now('UTC');
        });

        static::updating(fn () => throw new LogicException('Document governance events are append-only.'));
        static::deleting(fn () => throw new LogicException('Document governance events are retained as audit evidence.'));
    }

    /** @return list<Model> */
    private static function linkedModels(self $event): array
    {
        $links = [
            [DocumentBatch::class, $event->document_batch_id],
            [DocumentFile::class, $event->document_file_id],
            [DocumentProcessingRun::class, $event->document_processing_run_id],
            [DocumentRetentionHold::class, $event->document_retention_hold_id],
            [DocumentRedactionOverlay::class, $event->document_redaction_overlay_id],
        ];

        $found = [];
        foreach ($links as [$class, $id]) {
            if ($id !== null) {
                $found[] = $class::query()->findOrFail($id);
            }
        }

        return $found;
    }

    /** @param array<string,mixed> $metadata */
    private static function safeMetadata(array $metadata): bool
    {
        $allowed = ['retry_sequence', 'dry_run', 'export_scope', 'row_limit', 'policy_key', 'field_path'];

        return array_diff(array_keys($metadata), $allowed) === [];
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(DocumentFile::class, 'document_file_id');
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(DocumentProcessingRun::class, 'document_processing_run_id');
    }

    public function hold(): BelongsTo
    {
        return $this->belongsTo(DocumentRetentionHold::class, 'document_retention_hold_id');
    }

    public function redaction(): BelongsTo
    {
        return $this->belongsTo(DocumentRedactionOverlay::class, 'document_redaction_overlay_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
