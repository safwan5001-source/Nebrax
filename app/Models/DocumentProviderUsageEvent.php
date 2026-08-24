<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** دليل استهلاك غير مالي لمحاولة مزود ناجحة. */
class DocumentProviderUsageEvent extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_provider_attempt_id',
        'document_batch_id',
        'provider_key',
        'model',
        'provider_event_key',
        'page_count',
        'input_tokens',
        'output_tokens',
        'processing_duration_ms',
        'currency',
        'cost_minor',
        'cost_policy_version',
        'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'page_count' => 'integer',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'processing_duration_ms' => 'integer',
            'cost_minor' => 'integer',
            'occurred_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document provider usage events require trusted tenant and branch contexts.');
            }

            $attempt = DocumentProviderAttempt::query()->findOrFail($event->document_provider_attempt_id);
            if ($attempt->tenant_id !== $tenant->id() || $attempt->branch_id !== $branch->id()) {
                throw new LogicException('Document provider usage event scope must match its provider attempt.');
            }

            if ($event->document_batch_id !== $attempt->document_batch_id) {
                throw new LogicException('Document provider usage event batch must match its provider attempt.');
            }

            $event->tenant_id = $tenant->id();
            $event->branch_id = $branch->id();
        });

        static::updating(fn () => throw new LogicException('Document provider usage events are immutable.'));
        static::deleting(fn () => throw new LogicException('Document provider usage events are retained as audit evidence.'));
    }

    public function providerAttempt(): BelongsTo
    {
        return $this->belongsTo(DocumentProviderAttempt::class, 'document_provider_attempt_id');
    }
}
