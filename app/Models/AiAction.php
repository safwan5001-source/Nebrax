<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiAction extends BaseModel implements CompanyWide
{
    public const STATUS_CREATED = 'created';
    public const STATUS_EDITING = 'editing';
    public const STATUS_CANCELLED = 'cancelled';

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

    public function versions(): HasMany
    {
        return $this->hasMany(AiActionVersion::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(AiActionEvent::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
