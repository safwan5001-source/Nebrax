<?php

namespace App\Models;

use App\Support\DocumentWorkflowStatus;
use App\Tenancy\BranchScoped;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل append-only منقح لكل انتقال ناجح في سير عمل حزمة مستندات. */
class DocumentWorkflowEvent extends BaseModel
{
    use BranchScoped;

    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'from_status' => DocumentWorkflowStatus::class,
            'to_status' => DocumentWorkflowStatus::class,
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
                throw new LogicException('Document workflow events require trusted tenant and branch contexts.');
            }
            $batch = DocumentBatch::query()->findOrFail($event->document_batch_id);
            if ($batch->tenant_id !== $tenant->id() || $batch->branch_id !== $branch->id()) {
                throw new LogicException('Document workflow event scope must match its batch.');
            }
            $event->tenant_id = $tenant->id();
            $event->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('Document workflow events are immutable.'));
        static::deleting(fn () => throw new LogicException('Document workflow events cannot be deleted.'));
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(DocumentBatch::class, 'document_batch_id');
    }
}
