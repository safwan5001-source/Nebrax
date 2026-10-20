<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** AI-ACTIONS-05: per-row result. A successful row is final — it can never be re-run. */
class AiActionExecutionRow extends BaseModel implements CompanyWide
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILED = 'failed';
    public const STATUS_SKIPPED = 'skipped';

    protected $fillable = [
        'tenant_id', 'ai_action_execution_id', 'ai_action_id', 'row_id', 'source_row', 'operation',
        'status', 'product_id', 'error_code', 'error_message', 'retryable', 'attempts',
        'changed_fields', 'deferred', 'started_at', 'finished_at',
    ];

    protected $casts = [
        'source_row' => 'integer',
        'retryable' => 'boolean',
        'attempts' => 'integer',
        'changed_fields' => 'array',
        'deferred' => 'array',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $row): void {
            if (in_array($row->getOriginal('status'), [self::STATUS_SUCCESS, self::STATUS_SKIPPED], true)) {
                throw new LogicException('A finished execution row is final.');
            }
        });
        static::deleting(fn () => throw new LogicException('Execution rows are append-only.'));
    }

    public function execution(): BelongsTo
    {
        return $this->belongsTo(AiActionExecution::class, 'ai_action_execution_id');
    }
}
