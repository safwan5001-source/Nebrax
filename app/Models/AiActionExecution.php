<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** AI-ACTIONS-05: the single execution of one approval, with its lease and final status. */
class AiActionExecution extends BaseModel implements CompanyWide
{
    public const STATUS_RUNNING = 'running';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_PARTIALLY_FAILED = 'partially_failed';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'tenant_id', 'ai_action_id', 'ai_action_approval_id', 'ai_action_preview_id', 'action_version',
        'branch_id', 'preview_hash', 'started_by', 'status', 'retry_count', 'claim_token',
        'locked_until', 'started_at', 'finished_at',
    ];

    protected $casts = [
        'action_version' => 'integer',
        'retry_count' => 'integer',
        'locked_until' => 'datetime',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }

    public function approval(): BelongsTo
    {
        return $this->belongsTo(AiActionApproval::class, 'ai_action_approval_id');
    }

    public function rows(): HasMany
    {
        return $this->hasMany(AiActionExecutionRow::class, 'ai_action_execution_id');
    }
}
