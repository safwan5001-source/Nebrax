<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** AI-ACTIONS-04: an approval is never edited; it can only be revoked. */
class AiActionApproval extends BaseModel implements CompanyWide
{
    private const MUTABLE = ['revoked_at', 'revocation_reason', 'updated_at'];

    protected $fillable = [
        'tenant_id', 'ai_action_id', 'ai_action_preview_id', 'action_version', 'branch_id',
        'preview_hash', 'approved_by', 'permission_digest', 'approved_at', 'expires_at',
        'revoked_at', 'revocation_reason',
    ];

    protected $casts = [
        'action_version' => 'integer',
        'approved_at' => 'datetime',
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $approval): void {
            if (array_diff(array_keys($approval->getDirty()), self::MUTABLE) !== []) {
                throw new LogicException('AI action approvals are immutable.');
            }
        });
        static::deleting(fn () => throw new LogicException('AI action approvals are immutable.'));
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }

    public function preview(): BelongsTo
    {
        return $this->belongsTo(AiActionPreview::class, 'ai_action_preview_id');
    }

    public function isActive(): bool
    {
        return $this->revoked_at === null && $this->expires_at->isFuture();
    }
}
