<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiAction extends BaseModel implements CompanyWide
{
    public const STATUS_CREATED = 'created';
    public const STATUS_EDITING = 'editing';
    public const STATUS_READY_FOR_APPROVAL = 'ready_for_approval';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_EXECUTING = 'executing';
    public const STATUS_EXECUTED = 'executed';
    public const STATUS_PARTIALLY_FAILED = 'partially_failed';
    public const STATUS_FAILED = 'failed';
    public const STATUS_CANCELLED = 'cancelled';

    /** States in which a draft can still change (any change invalidates previews and approvals). */
    public const MUTABLE_STATUSES = [
        self::STATUS_CREATED, self::STATUS_EDITING, self::STATUS_READY_FOR_APPROVAL,
        self::STATUS_APPROVED, self::STATUS_EXPIRED,
    ];

    protected $fillable = [
        'tenant_id', 'branch_id', 'type', 'schema_version', 'status', 'version',
        'created_by', 'cancelled_by', 'cancelled_at', 'expires_at',
    ];

    protected $casts = [
        'schema_version' => 'integer',
        'version' => 'integer',
        'cancelled_at' => 'datetime',
        'expires_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        // AI-ACTIONS-07: the rows' private objects must go with the action, never while still needed, never half-way.
        static::deleting(static function (self $action): void {
            app(\App\Services\AiActionStagedImageRetention::class)->purgeBeforeDeleting($action);
        });
    }

    public function versions(): HasMany
    {
        return $this->hasMany(AiActionVersion::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(AiActionEvent::class);
    }

    public function files(): HasMany
    {
        return $this->hasMany(AiActionFile::class);
    }

    public function extractions(): HasMany
    {
        return $this->hasMany(AiActionExtraction::class);
    }

    public function previews(): HasMany
    {
        return $this->hasMany(AiActionPreview::class);
    }

    public function approvals(): HasMany
    {
        return $this->hasMany(AiActionApproval::class);
    }

    public function executions(): HasMany
    {
        return $this->hasMany(AiActionExecution::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
