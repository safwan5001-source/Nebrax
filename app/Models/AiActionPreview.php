<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

/** AI-ACTIONS-04: immutable preview content; only invalidation fields may change. */
class AiActionPreview extends BaseModel implements CompanyWide
{
    private const MUTABLE = ['invalidated_at', 'invalidation_reason', 'updated_at'];

    protected $fillable = [
        'tenant_id', 'ai_action_id', 'action_version', 'branch_id', 'preview_hash',
        'proposal_hash', 'manifest_hash', 'preview', 'summary', 'approvable',
        'generated_by', 'expires_at', 'invalidated_at', 'invalidation_reason',
    ];

    protected $casts = [
        'action_version' => 'integer',
        'preview' => 'array',
        'summary' => 'array',
        'approvable' => 'boolean',
        'expires_at' => 'datetime',
        'invalidated_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $preview): void {
            if (array_diff(array_keys($preview->getDirty()), self::MUTABLE) !== []) {
                throw new LogicException('AI action previews are immutable.');
            }
        });
        static::deleting(fn () => throw new LogicException('AI action previews are immutable.'));
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }

    public function approval(): HasOne
    {
        return $this->hasOne(AiActionApproval::class, 'ai_action_preview_id');
    }

    public function isActive(): bool
    {
        return $this->invalidated_at === null && $this->expires_at->isFuture();
    }
}
