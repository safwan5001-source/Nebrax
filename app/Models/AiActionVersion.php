<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class AiActionVersion extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'ai_action_id', 'version', 'proposal', 'proposal_hash',
        'validation_summary', 'created_by',
    ];

    protected $casts = [
        'version' => 'integer',
        'proposal' => 'array',
        'validation_summary' => 'array',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('AI action versions are immutable.'));
        static::deleting(fn () => throw new LogicException('AI action versions are immutable.'));
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }
}
