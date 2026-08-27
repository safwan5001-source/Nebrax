<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل تدقيق مستقل وآمن لأحداث استقبال المصدر وحياة هوية القناة. */
class DocumentSourceAuditEvent extends BaseModel
{
    use BranchScoped;

    public const RECEIVED = 'document_source_received';

    public const REPLAYED = 'document_source_replayed';

    public const CONFLICT_REJECTED = 'document_source_conflict_rejected';

    public const REJECTED = 'document_source_rejected';

    public const IDENTITY_CREATED = 'document_channel_identity_created';

    public const IDENTITY_DISABLED = 'document_channel_identity_disabled';

    public const IDENTITY_ENABLED = 'document_channel_identity_enabled';

    protected $fillable = [
        'document_channel_identity_id',
        'document_source_receipt_id',
        'document_batch_id',
        'event',
        'reason_safe',
        'metadata',
        'performed_by',
        'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'occurred_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document source audit events require trusted tenant and branch contexts.');
            }

            $event->tenant_id = $tenant->id();
            $event->branch_id = $branch->id();
        });

        static::updating(fn () => throw new LogicException('Document source audit events are append-only.'));
        static::deleting(fn () => throw new LogicException('Document source audit events are append-only.'));
    }

    public function identity(): BelongsTo
    {
        return $this->belongsTo(DocumentChannelIdentity::class, 'document_channel_identity_id');
    }

    public function receipt(): BelongsTo
    {
        return $this->belongsTo(DocumentSourceReceiptRecord::class, 'document_source_receipt_id');
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function performer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'performed_by');
    }
}
