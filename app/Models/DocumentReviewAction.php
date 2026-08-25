<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class DocumentReviewAction extends BaseModel
{
    use BranchScoped;

    public $timestamps = false;

    protected $fillable = [
        'document_batch_id', 'document_extraction_result_id', 'subject_type', 'subject_id',
        'action', 'before', 'after', 'actor_id', 'reason', 'review_version', 'occurred_at',
    ];

    protected function casts(): array
    {
        return ['before' => 'array', 'after' => 'array', 'review_version' => 'integer', 'occurred_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $action): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) throw new LogicException('Document review actions require trusted tenant and branch contexts.');

            $batch = DocumentBatch::query()->findOrFail($action->document_batch_id);
            if ($batch->tenant_id !== $tenant->id() || $batch->branch_id !== $branch->id()) throw new LogicException('Document review action scope must match its batch.');
            if ($action->document_extraction_result_id !== null) {
                $result = DocumentExtractionResult::query()->findOrFail($action->document_extraction_result_id);
                if ($result->tenant_id !== $tenant->id() || $result->branch_id !== $branch->id() || $result->document_batch_id !== $batch->id) throw new LogicException('Document review action extraction result must match its batch scope.');
            }
            $action->before = self::safeSnapshot($action->before);
            $action->after = self::safeSnapshot($action->after);
            $action->reason = self::safeReason($action->reason);
            $action->tenant_id = $tenant->id();
            $action->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('Document review actions are immutable.'));
        static::deleting(fn () => throw new LogicException('Document review actions cannot be deleted.'));
    }

    private static function safeSnapshot(?array $snapshot): ?array
    {
        if ($snapshot === null) return null;
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);
        if (strlen($encoded) > 4096 || preg_match('/(api[_-]?key|secret|token|password|raw[_-]?payload|object[_-]?key)/i', $encoded)) throw new LogicException('Document review audit snapshots must be bounded and contain no sensitive fields.');
        return $snapshot;
    }
    private static function safeReason(?string $reason): ?string { if ($reason !== null && mb_strlen($reason) > 500) throw new LogicException('Document review audit reason exceeds the safe limit.'); return $reason; }
    public function batch(): BelongsTo { return $this->belongsTo(DocumentBatch::class, 'document_batch_id'); }
    public function actor(): BelongsTo { return $this->belongsTo(User::class, 'actor_id'); }
}
