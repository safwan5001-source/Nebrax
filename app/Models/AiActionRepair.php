<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** AI-ACTIONS-06B: immutable link between a repair action and the execution whose failed rows it re-submits. */
class AiActionRepair extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'ai_action_id', 'origin_action_id', 'origin_execution_id', 'created_by', 'rows'];

    protected $casts = ['rows' => 'array'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('A repair record is immutable.'));
        static::deleting(fn () => throw new LogicException('A repair record is immutable.'));
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }

    public function origin(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'origin_action_id');
    }
}
