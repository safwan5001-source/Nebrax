<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** مرساة قبول تسليم القناة: واحدة لكل هوية/قناة/مرجع خارجي مطبّع. */
class DocumentSourceReceiptRecord extends BaseModel
{
    use BranchScoped;

    protected $table = 'document_source_receipts';

    protected $fillable = [
        'document_channel_identity_id',
        'channel',
        'external_reference_fingerprint',
        'external_reference_masked',
        'content_sha256',
        'document_batch_id',
        'document_file_id',
        'received_by',
        'received_at',
    ];

    protected function casts(): array
    {
        return [
            'received_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $receipt): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document source receipts require trusted tenant and branch contexts.');
            }

            $identity = DocumentChannelIdentity::query()->findOrFail($receipt->document_channel_identity_id);
            $batch = DocumentBatch::query()->findOrFail($receipt->document_batch_id);
            $file = DocumentFile::query()->findOrFail($receipt->document_file_id);
            foreach ([$identity, $batch, $file] as $record) {
                if ($record->tenant_id !== $tenant->id() || $record->branch_id !== $branch->id()) {
                    throw new LogicException('Document source receipt scope must match trusted identity, batch, and file.');
                }
            }
            if ($file->document_batch_id !== $batch->id || $receipt->channel !== $identity->channel->value) {
                throw new LogicException('Document source receipt evidence is inconsistent.');
            }

            $receipt->tenant_id = $tenant->id();
            $receipt->branch_id = $branch->id();
        });

        static::updating(fn () => throw new LogicException('Document source receipts are append-only.'));
        static::deleting(fn () => throw new LogicException('Document source receipts are append-only.'));
    }

    public function identity(): BelongsTo
    {
        return $this->belongsTo(DocumentChannelIdentity::class, 'document_channel_identity_id');
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(DocumentFile::class, 'document_file_id');
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by');
    }
}
