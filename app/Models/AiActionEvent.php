<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class AiActionEvent extends BaseModel implements CompanyWide
{
    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'ai_action_id', 'version', 'event', 'from_status',
        'to_status', 'actor_id', 'metadata', 'occurred_at',
    ];

    protected $casts = [
        'version' => 'integer',
        'metadata' => 'array',
        'occurred_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('AI action events are append-only.'));
        static::deleting(fn () => throw new LogicException('AI action events are append-only.'));
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }
}
